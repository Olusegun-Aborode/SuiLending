import { fetchAllPools } from '@/lib/sdk';
async function main() {
  const pools = await fetchAllPools();
  console.log(`fetched ${pools.length} pools from NAVI`);
  console.log('first 5 — ltv / liquidationThreshold / irm.reserveFactor:');
  for (const p of pools.slice(0, 5)) {
    console.log(`  ${p.symbol.padEnd(8)} ltv=${p.ltv}  lt=${p.liquidationThreshold}  rf=${p.irm?.reserveFactor ?? 'undefined'}  kink=${p.irm?.kink ?? 'undefined'}`);
  }
  // Count populated vs zero
  let withLtv = 0, withLt = 0, withRf = 0;
  for (const p of pools) {
    if (p.ltv > 0) withLtv++;
    if (p.liquidationThreshold > 0) withLt++;
    if (p.irm && p.irm.reserveFactor > 0) withRf++;
  }
  console.log(`\npopulated counts: ltv ${withLtv}/${pools.length}, lt ${withLt}/${pools.length}, rf ${withRf}/${pools.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
