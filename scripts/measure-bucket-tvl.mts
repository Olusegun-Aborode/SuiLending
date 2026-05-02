/**
 * Measure Bucket TVL coverage end-to-end.
 *
 * Calls the same code path the API uses (Bucket adapter → fetchPools), sums
 * totalSupplyUsd, compares against DefiLlama's reference figure, prints
 * coverage. Used to validate gap-closing work without spinning up Next.
 *
 * Run:
 *   set -a && source .env.local && set +a && npx tsx scripts/measure-bucket-tvl.mts
 */

import bucketAdapter from '../src/protocols/bucket/adapter';

(async () => {
  console.log('Fetching Bucket pools (full adapter run)…\n');
  const t0 = Date.now();
  const pools = await bucketAdapter.fetchPools();
  const ms = Date.now() - t0;
  console.log(`  ${pools.length} rows in ${ms}ms\n`);

  // Group by symbol prefix to show what each surface contributes
  const byPrefix: Record<string, { count: number; tvl: number }> = {};
  let totalTvl = 0;
  for (const p of pools) {
    const m = p.symbol.match(/^([A-Z][A-Z0-9]*-)/);
    const prefix = m ? m[1].slice(0, -1) : 'CANONICAL';
    if (!byPrefix[prefix]) byPrefix[prefix] = { count: 0, tvl: 0 };
    byPrefix[prefix].count += 1;
    byPrefix[prefix].tvl += p.totalSupplyUsd;
    totalTvl += p.totalSupplyUsd;
  }

  console.log('─── TVL by surface ───────────────────────────────────────────');
  Object.entries(byPrefix)
    .sort((a, b) => b[1].tvl - a[1].tvl)
    .forEach(([prefix, info]) => {
      const usd = info.tvl;
      const fmt = usd > 1e6 ? `$${(usd / 1e6).toFixed(2)}M` : usd > 1e3 ? `$${(usd / 1e3).toFixed(1)}K` : `$${usd.toFixed(0)}`;
      console.log(`  ${prefix.padEnd(16)} ${String(info.count).padStart(4)} rows  ${fmt.padStart(10)}`);
    });

  console.log(`\n  TOTAL          ${String(pools.length).padStart(4)} rows  $${(totalTvl / 1e6).toFixed(2).padStart(8)}M`);

  // Compare to DefiLlama's reference
  try {
    const r = await fetch('https://api.llama.fi/tvl/bucket-protocol');
    if (r.ok) {
      const ref = Number(await r.text());
      const coverage = (totalTvl / ref) * 100;
      console.log(`\n  DefiLlama ref          $${(ref / 1e6).toFixed(2).padStart(8)}M`);
      console.log(`  Our coverage           ${coverage.toFixed(1).padStart(8)}%`);
      console.log(`  Gap to close           $${((ref - totalTvl) / 1e6).toFixed(2).padStart(8)}M`);
    }
  } catch (e) {
    console.log(`  (DefiLlama fetch failed: ${(e as Error).message})`);
  }
})();
