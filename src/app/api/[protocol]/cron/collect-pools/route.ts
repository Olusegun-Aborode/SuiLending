import { NextResponse } from 'next/server';
import { CRON_SECRET } from '@/lib/constants';
import { getProtocol } from '@/protocols/registry';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ protocol: string }> }
) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { protocol: slug } = await params;
  const entry = getProtocol(slug);

  if (!entry) {
    return NextResponse.json({ error: `Unknown protocol: ${slug}` }, { status: 404 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'No database configured' }, { status: 503 });
  }

  try {
    const pools = await entry.adapter.fetchPools();

    if (pools.length === 0) {
      return NextResponse.json({ warning: 'No pool data returned' });
    }

    // NAVI's open API occasionally returns numeric fields as strings
    // (e.g. "price": "0.999788"). Prisma's Float columns reject strings,
    // so coerce at the write boundary.
    const num = (v: unknown) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const snapshots = pools.map((pool) => ({
      protocol: slug,
      symbol: pool.symbol,
      totalSupply: num(pool.totalSupply),
      totalSupplyUsd: num(pool.totalSupplyUsd),
      totalBorrows: num(pool.totalBorrows),
      totalBorrowsUsd: num(pool.totalBorrowsUsd),
      availableLiquidity: num(pool.availableLiquidity),
      availableLiquidityUsd: num(pool.availableLiquidityUsd),
      supplyApy: num(pool.supplyApy),
      borrowApy: num(pool.borrowApy),
      utilization: num(pool.utilization),
      price: num(pool.price),
    }));

    await db.poolSnapshot.createMany({ data: snapshots });

    // Upsert RateModelParams for any pool the adapter populated `irm` for.
    // IRM params change rarely (governance updates only), so per-pool unique
    // keyed by (protocol, symbol) is the right granularity — not snapshot-style.
    let irmWritten = 0;
    for (const pool of pools) {
      if (!pool.irm) continue;
      try {
        await db.rateModelParams.upsert({
          where: { protocol_symbol: { protocol: slug, symbol: pool.symbol } },
          update: {
            baseRate:       num(pool.irm.baseRate),
            multiplier:     num(pool.irm.multiplier),
            jumpMultiplier: num(pool.irm.jumpMultiplier),
            kink:           num(pool.irm.kink),
            reserveFactor:  num(pool.irm.reserveFactor),
            updatedAt:      new Date(),
          },
          create: {
            protocol: slug,
            symbol: pool.symbol,
            baseRate:       num(pool.irm.baseRate),
            multiplier:     num(pool.irm.multiplier),
            jumpMultiplier: num(pool.irm.jumpMultiplier),
            kink:           num(pool.irm.kink),
            reserveFactor:  num(pool.irm.reserveFactor),
          },
        });
        irmWritten += 1;
      } catch (e) {
        // One pool's IRM upsert failing shouldn't break the whole snapshot;
        // log and continue.
        console.warn(`[collect-pools/${slug}] irm upsert ${pool.symbol}:`, e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({
      success: true,
      protocol: slug,
      poolsCollected: pools.length,
      irmWritten,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`collect-pools[${slug}] error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
