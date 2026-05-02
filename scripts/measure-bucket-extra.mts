/**
 * Measure ONLY the new extra-tvl surfaces (PSM/Savings/Fountain/etc).
 * Bypasses the Bucket SDK so it loads under raw tsx (the SDK's package
 * exports map breaks tsx but works under Next).
 *
 * The number printed here is what the new commit ADDS on top of what we
 * already had (V2 vaults + V1 walk + Scallop sCoins).
 */

import { fetchBucketExtraTvl } from '../src/protocols/bucket/extra-tvl';
import { fetchSuiCoinPrices, fetchScallopSCoinPrices } from '../src/lib/prices';

(async () => {
  // Fetch the same prices the adapter would use. These are the canonical
  // tokens that show up across every Bucket extra surface.
  const seedCoinTypes = [
    '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
    '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    '0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI',
    '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN', // WBTC
    '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', // wormhole USDC
    '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN', // wormhole USDT
    '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
    '0xf16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD',
    '0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK',
  ];
  const [llama, scoin] = await Promise.all([
    fetchSuiCoinPrices(seedCoinTypes),
    fetchScallopSCoinPrices(),
  ]);
  const prices = { ...llama, ...scoin };
  console.log(`Seeded ${Object.keys(prices).length} prices\n`);

  const t0 = Date.now();
  const rows = await fetchBucketExtraTvl(prices);
  const ms = Date.now() - t0;
  console.log(`Walked Bucket extra surfaces in ${ms}ms — ${rows.length} rows\n`);

  let total = 0;
  console.log('Symbol                         TVL');
  console.log('────────────────────────────────────────');
  rows.sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd).forEach(r => {
    total += r.totalSupplyUsd;
    const usd = r.totalSupplyUsd;
    const fmt = usd > 1e6 ? `$${(usd / 1e6).toFixed(2)}M` : usd > 1e3 ? `$${(usd / 1e3).toFixed(1)}K` : `$${usd.toFixed(2)}`;
    console.log(`${r.symbol.padEnd(30)}${fmt.padStart(12)}`);
  });
  console.log('────────────────────────────────────────');
  console.log(`TOTAL extra TVL recovered     $${(total / 1e6).toFixed(2)}M\n`);

  try {
    const r = await fetch('https://api.llama.fi/tvl/bucket-protocol');
    if (r.ok) {
      const ref = Number(await r.text());
      console.log(`DefiLlama Bucket TVL          $${(ref / 1e6).toFixed(2)}M`);
      console.log(`Already covered (V2+V1+sCoin) ~$7.2M (per prior probe)`);
      console.log(`After this commit (rough)     $${((7.2 * 1e6 + total) / 1e6).toFixed(2)}M`);
      console.log(`Coverage gap remaining        $${((ref - total - 7.2e6) / 1e6).toFixed(2)}M`);
    }
  } catch (e) {
    console.log(`(DefiLlama fetch failed: ${(e as Error).message})`);
  }
})();
