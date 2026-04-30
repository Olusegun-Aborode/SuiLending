import { NextResponse } from 'next/server';
import { isValidProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/[protocol]/liquidations/leaderboard?page=1&limit=50
 *
 * Ranks unique liquidators by gross profit
 *   = SUM(collateralUsd) − SUM(debtUsd) − SUM(treasuryAmount × collateralPrice)
 *
 * Per-row fields:
 *   liquidator, count, totalCollateralUsd, totalDebtUsd, treasuryUsd,
 *   grossProfit, totalGasUsd, netProfit, firstSeen, lastSeen
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
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 50)));
  const offset = (page - 1) * limit;

  const db = getDb();
  if (!db) {
    return NextResponse.json({ leaderboard: [], total: 0, page, limit });
  }

  type Row = {
    liquidator: string;
    count: bigint;
    totalCollateralUsd: number;
    totalDebtUsd: number;
    treasuryUsd: number;
    grossProfit: number;
    totalGasUsd: number;
    firstSeen: Date;
    lastSeen: Date;
  };

  try {
    const rows = await db.$queryRaw<Row[]>`
      SELECT
        liquidator,
        COUNT(*)::bigint                                                AS "count",
        SUM("collateralUsd")::float8                                    AS "totalCollateralUsd",
        SUM("debtUsd")::float8                                          AS "totalDebtUsd",
        SUM("treasuryAmount" * "collateralPrice")::float8               AS "treasuryUsd",
        SUM("collateralUsd" - "debtUsd" - "treasuryAmount" * "collateralPrice")::float8 AS "grossProfit",
        COALESCE(SUM("gasUsd"), 0)::float8                              AS "totalGasUsd",
        MIN(timestamp)                                                  AS "firstSeen",
        MAX(timestamp)                                                  AS "lastSeen"
      FROM "LiquidationEvent"
      WHERE protocol = ${slug}
      GROUP BY liquidator
      ORDER BY "grossProfit" DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const totalRow = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT liquidator)::bigint AS "count"
      FROM "LiquidationEvent"
      WHERE protocol = ${slug}
    `;
    const total = Number(totalRow[0]?.count ?? 0);

    const leaderboard = rows.map((r: Row) => ({
      ...r,
      count: Number(r.count),
      netProfit: r.grossProfit - r.totalGasUsd,
    }));

    return NextResponse.json({ leaderboard, total, page, limit });
  } catch (error) {
    console.error(`/api/${slug}/liquidations/leaderboard error:`, error);
    return NextResponse.json(
      { leaderboard: [], total: 0, page, limit, error: 'Query failed' },
      { status: 500 }
    );
  }
}
