import { fetchAllPools } from '@/lib/sdk';
import { getDb } from '@/lib/db';

async function main() {
  const pools = await fetchAllPools();
  console.log(`fetched ${pools.length} pools via fetchAllPools()`);
  console.log('first 5:');
  for (const p of pools.slice(0, 5)) {
    console.log(`  ${p.symbol.padEnd(8)} ltv=${p.ltv}  lt=${p.liquidationThreshold}  irm.rf=${p.irm?.reserveFactor}`);
  }

  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const db = getDb();
  if (!db || pools.length === 0) return;

  const test = pools[0];
  console.log(`\n--- writing test row for ${test.symbol} with ltv=${test.ltv} lt=${test.liquidationThreshold} ---`);
  try {
    const r = await db.poolSnapshot.create({
      data: {
        protocol: 'navi',
        symbol: '__TEST_' + test.symbol,
        totalSupply: num(test.totalSupply),
        totalSupplyUsd: num(test.totalSupplyUsd),
        totalBorrows: num(test.totalBorrows),
        totalBorrowsUsd: num(test.totalBorrowsUsd),
        availableLiquidity: num(test.availableLiquidity),
        availableLiquidityUsd: num(test.availableLiquidityUsd),
        supplyApy: num(test.supplyApy),
        borrowApy: num(test.borrowApy),
        utilization: num(test.utilization),
        price: num(test.price),
        ltv: num(test.ltv),
        liquidationThreshold: num(test.liquidationThreshold),
      },
    });
    console.log(`wrote test row id=${r.id} ltv=${r.ltv} lt=${r.liquidationThreshold}`);
    await db.poolSnapshot.delete({ where: { id: r.id } });
    console.log('cleaned up test row');
  } catch (e) {
    console.error('WRITE FAILED:', e);
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
