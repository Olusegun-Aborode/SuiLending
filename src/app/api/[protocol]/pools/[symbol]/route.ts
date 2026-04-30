import { NextResponse } from 'next/server';
import { getProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Allowed values for ?days= — keeps the client from asking for absurd windows
// that would pull the whole table. 90 keeps the old default.
const ALLOWED_DAYS = new Set([7, 30, 90, 180, 365]);
const DEFAULT_DAYS = 90;

/**
 * GET /api/[protocol]/pools/[symbol]?days=N
 *
 * Single-pool detail. `days` controls the window for the returned
 * `history` series (Interest Rate + Utilization charts on the market
 * detail page). Defaults to 90 for backwards compatibility.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ protocol: string; symbol: string }> }
) {
  const { protocol: slug, symbol } = await params;
  const entry = getProtocol(slug);

  if (!entry) {
    return NextResponse.json({ error: `Unknown protocol: ${slug}` }, { status: 404 });
  }

  const upperSymbol = symbol.toUpperCase();

  // Parse ?days=, whitelisted.
  const { searchParams } = new URL(req.url);
  const rawDays = Number(searchParams.get('days') ?? DEFAULT_DAYS);
  const days = ALLOWED_DAYS.has(rawDays) ? rawDays : DEFAULT_DAYS;

  try {
    const pool = await entry.adapter.fetchPool(upperSymbol);

    // Fetch rate model params and history from DB if available
    const db = getDb();
    let rateModel = null;
    let history: unknown[] = [];
    let pairs: unknown = {};

    // Find asset config for color/name
    const assetConfig = entry.config.assets.find(
      (a) => a.symbol.toUpperCase() === upperSymbol
    );

    if (db) {
      rateModel = await db.rateModelParams.findUnique({
        where: { protocol_symbol: { protocol: slug, symbol: upperSymbol } },
      });

      const since = new Date();
      since.setDate(since.getDate() - days);
      history = await db.poolDaily.findMany({
        where: { protocol: slug, symbol: upperSymbol, date: { gte: since } },
        orderBy: { date: 'asc' },
      });

      // Get collateral/borrow pairs for this asset
      const collateralPairs = await db.collateralBorrowPair.findMany({
        where: { protocol: slug, collateralAsset: upperSymbol },
      });
      const borrowPairs = await db.collateralBorrowPair.findMany({
        where: { protocol: slug, borrowAsset: upperSymbol },
      });
      pairs = { asCollateral: collateralPairs, asBorrow: borrowPairs };
    }

    return NextResponse.json({
      pool: pool ?? null,
      rateModel,
      history,
      pairs,
      assetColor: assetConfig?.color ?? '#666',
      assetName: assetConfig?.name ?? upperSymbol,
    });
  } catch (error) {
    console.error(`/api/${slug}/pools/${upperSymbol} error:`, error);
    return NextResponse.json(
      { pool: null, error: 'Failed to fetch pool' },
      { status: 500 }
    );
  }
}
