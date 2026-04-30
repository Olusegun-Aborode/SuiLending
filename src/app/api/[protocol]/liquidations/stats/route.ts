import { NextResponse } from 'next/server';
import { isValidProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/[protocol]/liquidations/stats
 *
 * Returns four series derived from the last 30 days of liquidation events:
 *   - collateralDistribution — per-asset USD totals (donut)
 *   - dailySeized             — per-day USD totals (kept for clients that
 *                               only need the total)
 *   - dailySeizedByAsset      — per-day, per-asset USD totals, flattened so
 *                               Recharts can stack them directly
 *                               (e.g. `{ date, vSUI: 120, USDC: 45 }`)
 *   - dailySeizedAssets       — asset symbols present, sorted by total USD
 *                               desc; used for stacking order + legend
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ protocol: string }> }
) {
  const { protocol: slug } = await params;

  if (!isValidProtocol(slug)) {
    return NextResponse.json({ error: `Unknown protocol: ${slug}` }, { status: 404 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({
      collateralDistribution: [],
      dailySeized: [],
      dailySeizedByAsset: [],
      dailySeizedAssets: [],
      message: 'No database configured',
    });
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const events = await db.liquidationEvent.findMany({
      where: { protocol: slug, timestamp: { gte: thirtyDaysAgo } },
      select: { collateralAsset: true, collateralUsd: true, timestamp: true },
    });

    // Per-asset totals (for the donut).
    const distMap = new Map<string, number>();
    for (const evt of events) {
      distMap.set(evt.collateralAsset, (distMap.get(evt.collateralAsset) ?? 0) + evt.collateralUsd);
    }
    const collateralDistribution = Array.from(distMap.entries())
      .map(([asset, totalUsd]) => ({ asset, totalUsd }))
      .sort((a, b) => b.totalUsd - a.totalUsd);

    // Legacy per-day total (sum across all assets).
    const dailyMap = new Map<string, number>();
    // New: per-day, per-asset breakdown.
    const dailyByAssetMap = new Map<string, Map<string, number>>();
    for (const evt of events) {
      const day = evt.timestamp.toISOString().split('T')[0];
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + evt.collateralUsd);

      let inner = dailyByAssetMap.get(day);
      if (!inner) {
        inner = new Map<string, number>();
        dailyByAssetMap.set(day, inner);
      }
      inner.set(evt.collateralAsset, (inner.get(evt.collateralAsset) ?? 0) + evt.collateralUsd);
    }

    const dailySeized = Array.from(dailyMap.entries())
      .map(([date, totalUsd]) => ({ date, totalUsd }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Flatten the per-day map into Recharts-friendly row objects:
    //   [{ date: '2026-04-21', vSUI: 120, USDC: 45 }, ...]
    const dailySeizedByAsset = Array.from(dailyByAssetMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, inner]) => {
        const row: Record<string, string | number> = { date };
        for (const [asset, usd] of inner.entries()) row[asset] = usd;
        return row;
      });

    // Assets sorted by their 30d total so stacking order is stable and the
    // biggest contributor sits at the bottom of each stack.
    const dailySeizedAssets = collateralDistribution.map((d) => d.asset);

    return NextResponse.json({
      collateralDistribution,
      dailySeized,
      dailySeizedByAsset,
      dailySeizedAssets,
    });
  } catch (error) {
    console.error(`/api/${slug}/liquidations/stats error:`, error);
    return NextResponse.json(
      {
        collateralDistribution: [],
        dailySeized: [],
        dailySeizedByAsset: [],
        dailySeizedAssets: [],
        error: 'Query failed',
      },
      { status: 500 }
    );
  }
}
