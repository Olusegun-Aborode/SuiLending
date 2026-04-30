import { NextResponse } from 'next/server';
import { getProtocol } from '@/protocols/registry';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

/**
 * GET /api/[protocol]/pools — Returns current state of all pools.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ protocol: string }> }
) {
  const { protocol: slug } = await params;
  const entry = getProtocol(slug);

  if (!entry) {
    return NextResponse.json({ error: `Unknown protocol: ${slug}` }, { status: 404 });
  }

  try {
    const pools = await entry.adapter.fetchPools();

    const totalSupplyUsd = pools.reduce((s, p) => s + p.totalSupplyUsd, 0);
    const totalBorrowsUsd = pools.reduce((s, p) => s + p.totalBorrowsUsd, 0);
    const tvl = totalSupplyUsd - totalBorrowsUsd;

    // Live-deduped symbols (NAVI sometimes has two pools sharing a symbol,
    // e.g. bridged + native WBTC — dedup + sort for filter dropdowns).
    const symbols = Array.from(new Set(pools.map((p) => p.symbol))).sort();

    return NextResponse.json({
      pools,
      totals: { totalSupplyUsd, totalBorrowsUsd, tvl },
      protocolName: entry.config.name,
      symbols,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`/api/${slug}/pools error:`, error);
    return NextResponse.json(
      { pools: [], totals: { totalSupplyUsd: 0, totalBorrowsUsd: 0, tvl: 0 }, error: 'Failed to fetch pools' },
      { status: 500 }
    );
  }
}
