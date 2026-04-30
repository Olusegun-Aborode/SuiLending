import { NextResponse } from 'next/server';
import { isValidProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Whitelist of sort columns. Anything outside the allowed set falls back to
// healthFactor so a malformed / malicious `sortBy` can't pick an unindexed
// column and slow the query down.
const SORT_FIELDS = new Set(['healthFactor', 'collateralUsd', 'borrowUsd']);
type SortField = 'healthFactor' | 'collateralUsd' | 'borrowUsd';
type SortDir = 'asc' | 'desc';

/**
 * GET /api/[protocol]/wallets?page=1&limit=25&search=0x...&minHf=0
 *     &collateral=SUI&borrow=USDC&sortBy=healthFactor&sortDir=asc
 *
 * Response includes:
 *   - `riskCounts` — count of wallets per HF band across the *filtered*
 *     set (not just the current page). Used in the panel header for the
 *     "N critical · N warning · N total" summary.
 *   - `totals` — { supplyUsd, borrowUsd } aggregates across the filtered
 *     set. Used in the page-level KPI strip above the table.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ protocol: string }> }
) {
  const { protocol: slug } = await params;

  if (!isValidProtocol(slug)) {
    return NextResponse.json({ error: `Unknown protocol: ${slug}` }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 25)));
  const search = searchParams.get('search') ?? '';
  const minHf = Number(searchParams.get('minHf') ?? 0);
  const maxHf = Number(searchParams.get('maxHf') ?? 9999);
  const collateral = searchParams.get('collateral') ?? '';
  const borrow = searchParams.get('borrow') ?? '';

  const rawSortBy = searchParams.get('sortBy') ?? 'healthFactor';
  const rawSortDir = searchParams.get('sortDir') ?? 'asc';
  const sortBy: SortField = SORT_FIELDS.has(rawSortBy)
    ? (rawSortBy as SortField)
    : 'healthFactor';
  const sortDir: SortDir = rawSortDir === 'desc' ? 'desc' : 'asc';

  const db = getDb();
  if (!db) {
    return NextResponse.json({
      wallets: [],
      total: 0,
      page,
      limit,
      riskCounts: { danger: 0, warning: 0, safe: 0, total: 0 },
      totals: { supplyUsd: 0, borrowUsd: 0 },
      message: 'No database configured',
    });
  }

  try {
    const where: Record<string, unknown> = {
      protocol: slug,
      healthFactor: { gte: minHf, lte: maxHf },
      borrowUsd: { gt: 0 },
    };

    if (search) where.address = { contains: search };
    if (collateral) where.collateralAssets = { contains: collateral };
    if (borrow) where.borrowAssets = { contains: borrow };

    const [wallets, total, danger, warning, agg] = await Promise.all([
      db.walletPosition.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.walletPosition.count({ where }),
      // HF bands match lib/constants.ts:
      //   < 1.2  → danger   (liquidatable + critical)
      //   < 1.5  → warning
      //   ≥ 1.5  → safe
      db.walletPosition.count({
        where: { ...where, healthFactor: { gte: minHf, lt: 1.2 } },
      }),
      db.walletPosition.count({
        where: { ...where, healthFactor: { gte: 1.2, lt: 1.5 } },
      }),
      // Prisma aggregate: SUM across the filtered set. Null when the set
      // is empty, hence the `?? 0` fallbacks on read.
      db.walletPosition.aggregate({
        where,
        _sum: { collateralUsd: true, borrowUsd: true },
      }),
    ]);

    const safe = Math.max(0, total - danger - warning);

    return NextResponse.json({
      wallets,
      total,
      page,
      limit,
      riskCounts: { danger, warning, safe, total },
      totals: {
        supplyUsd: agg._sum.collateralUsd ?? 0,
        borrowUsd: agg._sum.borrowUsd ?? 0,
      },
    });
  } catch (error) {
    console.error(`/api/${slug}/wallets error:`, error);
    return NextResponse.json(
      {
        wallets: [],
        total: 0,
        page,
        limit,
        riskCounts: { danger: 0, warning: 0, safe: 0, total: 0 },
        totals: { supplyUsd: 0, borrowUsd: 0 },
        error: 'Query failed',
      },
      { status: 500 }
    );
  }
}
