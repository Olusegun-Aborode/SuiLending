import { NextResponse } from 'next/server';
import { isValidProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/[protocol]/liquidations/liquidator/[address]?page=1&limit=25
 *
 * Returns everything the per-liquidator profile page needs:
 *   - summary (count, profit totals, net of gas, first/last seen)
 *   - gasEfficiency (totals + ratio)
 *   - daily activity time-series
 *   - asset breakdowns (collateral seized + debt repaid)
 *   - top borrowers targeted
 *   - paginated event history
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ protocol: string; address: string }> }
) {
  const { protocol: slug, address } = await params;

  if (!isValidProtocol(slug)) {
    return NextResponse.json({ error: `Unknown protocol: ${slug}` }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 25)));
  const offset = (page - 1) * limit;

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'No database configured' }, { status: 503 });
  }

  try {
    const [summaryRow] = await db.$queryRaw<
      Array<{
        count: bigint;
        totalCollateralUsd: number;
        totalDebtUsd: number;
        treasuryUsd: number;
        grossProfit: number;
        totalGasUsd: number;
        firstSeen: Date;
        lastSeen: Date;
      }>
    >`
      SELECT
        COUNT(*)::bigint                                                AS "count",
        SUM("collateralUsd")::float8                                    AS "totalCollateralUsd",
        SUM("debtUsd")::float8                                          AS "totalDebtUsd",
        SUM("treasuryAmount" * "collateralPrice")::float8               AS "treasuryUsd",
        SUM("collateralUsd" - "debtUsd" - "treasuryAmount" * "collateralPrice")::float8 AS "grossProfit",
        COALESCE(SUM("gasUsd"), 0)::float8                              AS "totalGasUsd",
        MIN(timestamp)                                                  AS "firstSeen",
        MAX(timestamp)                                                  AS "lastSeen"
      FROM "LiquidationEvent"
      WHERE protocol = ${slug} AND liquidator = ${address}
    `;

    const count = Number(summaryRow?.count ?? 0);
    if (count === 0) {
      return NextResponse.json({ error: 'Liquidator not found' }, { status: 404 });
    }

    const grossProfit = summaryRow.grossProfit;
    const totalGasUsd = summaryRow.totalGasUsd;
    const summary = {
      ...summaryRow,
      count,
      netProfit: grossProfit - totalGasUsd,
      avgProfit: count > 0 ? grossProfit / count : 0,
    };

    const gasEfficiency = {
      totalGasUsd,
      avgGasUsdPerLiquidation: count > 0 ? totalGasUsd / count : 0,
      gasToProfitRatio: grossProfit > 0 ? totalGasUsd / grossProfit : null,
      coverage: 0, // % of events with gas indexed (filled in below)
    };
    const [gasCoverageRow] = await db.$queryRaw<Array<{ withGas: bigint }>>`
      SELECT COUNT(*)::bigint AS "withGas"
      FROM "LiquidationEvent"
      WHERE protocol = ${slug} AND liquidator = ${address} AND "gasUsd" IS NOT NULL
    `;
    gasEfficiency.coverage = count > 0 ? Number(gasCoverageRow.withGas) / count : 0;

    const daily = await db.$queryRaw<
      Array<{ date: Date; count: bigint; grossProfit: number; gasUsd: number }>
    >`
      SELECT
        date_trunc('day', timestamp)                                    AS "date",
        COUNT(*)::bigint                                                AS "count",
        SUM("collateralUsd" - "debtUsd" - "treasuryAmount" * "collateralPrice")::float8 AS "grossProfit",
        COALESCE(SUM("gasUsd"), 0)::float8                              AS "gasUsd"
      FROM "LiquidationEvent"
      WHERE protocol = ${slug} AND liquidator = ${address}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const collateralSeized = await db.$queryRaw<
      Array<{ asset: string; count: bigint; totalUsd: number }>
    >`
      SELECT "collateralAsset" AS "asset",
             COUNT(*)::bigint AS "count",
             SUM("collateralUsd")::float8 AS "totalUsd"
      FROM "LiquidationEvent"
      WHERE protocol = ${slug} AND liquidator = ${address}
      GROUP BY 1
      ORDER BY "totalUsd" DESC
    `;

    const debtRepaid = await db.$queryRaw<
      Array<{ asset: string; count: bigint; totalUsd: number }>
    >`
      SELECT "debtAsset" AS "asset",
             COUNT(*)::bigint AS "count",
             SUM("debtUsd")::float8 AS "totalUsd"
      FROM "LiquidationEvent"
      WHERE protocol = ${slug} AND liquidator = ${address}
      GROUP BY 1
      ORDER BY "totalUsd" DESC
    `;

    const topBorrowers = await db.$queryRaw<
      Array<{ borrower: string; count: bigint; totalCollateralUsd: number; totalDebtUsd: number }>
    >`
      SELECT borrower,
             COUNT(*)::bigint AS "count",
             SUM("collateralUsd")::float8 AS "totalCollateralUsd",
             SUM("debtUsd")::float8       AS "totalDebtUsd"
      FROM "LiquidationEvent"
      WHERE protocol = ${slug} AND liquidator = ${address}
      GROUP BY borrower
      ORDER BY "totalCollateralUsd" DESC
      LIMIT 10
    `;

    const [events, total] = await Promise.all([
      db.liquidationEvent.findMany({
        where: { protocol: slug, liquidator: address },
        orderBy: { timestamp: 'desc' },
        skip: offset,
        take: limit,
      }),
      db.liquidationEvent.count({
        where: { protocol: slug, liquidator: address },
      }),
    ]);

    type DailyRow = { date: Date; count: bigint; grossProfit: number; gasUsd: number };
    type AssetRow = { asset: string; count: bigint; totalUsd: number };
    type BorrowerRow = {
      borrower: string;
      count: bigint;
      totalCollateralUsd: number;
      totalDebtUsd: number;
    };

    return NextResponse.json({
      summary,
      gasEfficiency,
      daily: (daily as DailyRow[]).map((d) => ({
        date: d.date,
        count: Number(d.count),
        grossProfit: d.grossProfit,
        gasUsd: d.gasUsd,
      })),
      assets: {
        collateralSeized: (collateralSeized as AssetRow[]).map((r) => ({
          ...r,
          count: Number(r.count),
        })),
        debtRepaid: (debtRepaid as AssetRow[]).map((r) => ({
          ...r,
          count: Number(r.count),
        })),
      },
      topBorrowers: (topBorrowers as BorrowerRow[]).map((r) => ({
        ...r,
        count: Number(r.count),
      })),
      events: events.map((e: typeof events[number]) => ({
        ...e,
        gasUsedMist: e.gasUsedMist != null ? e.gasUsedMist.toString() : null,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error(`/api/${slug}/liquidations/liquidator/${address} error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Query failed' },
      { status: 500 }
    );
  }
}
