import { NextResponse } from 'next/server';
import { isValidProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/[protocol]/liquidations?page=1&limit=25&borrower=0x...
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
  const borrower = searchParams.get('borrower') ?? '';
  const liquidator = searchParams.get('liquidator') ?? '';
  const collateral = searchParams.get('collateral') ?? '';
  const debt = searchParams.get('debt') ?? '';
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const db = getDb();
  if (!db) {
    return NextResponse.json({ events: [], total: 0, page, limit, message: 'No database configured' });
  }

  try {
    const where: Record<string, unknown> = { protocol: slug };

    if (borrower) where.borrower = { contains: borrower };
    if (liquidator) where.liquidator = { contains: liquidator };
    if (collateral) where.collateralAsset = collateral;
    if (debt) where.debtAsset = debt;
    if (from || to) {
      where.timestamp = {};
      if (from) (where.timestamp as Record<string, unknown>).gte = new Date(from);
      if (to) (where.timestamp as Record<string, unknown>).lte = new Date(to);
    }

    const [events, total] = await Promise.all([
      db.liquidationEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.liquidationEvent.count({ where }),
    ]);

    return NextResponse.json({ events, total, page, limit });
  } catch (error) {
    console.error(`/api/${slug}/liquidations error:`, error);
    return NextResponse.json(
      { events: [], total: 0, page, limit, error: 'Query failed' },
      { status: 500 }
    );
  }
}
