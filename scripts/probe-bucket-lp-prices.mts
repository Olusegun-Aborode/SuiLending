/**
 * Diagnostic: which of Bucket's collateral coin types does DefiLlama price?
 *
 * Walks the V1 protocol's dynamic fields the same way the adapter does,
 * collects every coinType present, then queries DefiLlama's `/coins/prices`
 * for each one and reports:
 *   - which coins DefiLlama returns a price for
 *   - which it doesn't (those are the LP tokens we'd still miss under Option 1)
 *   - rough USD valuation of the priced subset
 *
 * Run:
 *   set -a && source .env.local && set +a && npx tsx scripts/probe-bucket-lp-prices.mts
 */

import { BucketClient } from '@bucket-protocol/sdk';

const SUI_GRAPHQL = process.env.SUI_GRAPHQL_URL ?? 'https://graphql.mainnet.sui.io/graphql';
const V1_PROTOCOL = '0x9e3dab13212b27f5434416939db5dec6a319d15b89a84fd074d03ece6350d3df';

async function fetchV1FieldsCoinTypes(): Promise<Array<{ kind: string; coinType: string; rawAmount: string; rawDecimals: number }>> {
  const out: Array<{ kind: string; coinType: string; rawAmount: string; rawDecimals: number }> = [];
  const query = `
    query($parent: SuiAddress!, $cursor: String) {
      address(address: $parent) {
        dynamicFields(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            value {
              __typename
              ... on MoveValue  { type { repr } json }
              ... on MoveObject { contents { type { repr } json } }
            }
          }
        }
      }
    }
  `;
  let cursor: string | null = null;
  for (let p = 0; p < 8; p++) {
    const r = await fetch(SUI_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { parent: V1_PROTOCOL, cursor } }),
    });
    if (!r.ok) break;
    const j = await r.json() as { data?: { address?: { dynamicFields?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ value?: { __typename?: string; json?: Record<string, unknown>; type?: { repr?: string }; contents?: { type?: { repr?: string }; json?: Record<string, unknown> } } }> } } } };
    const dfs = j.data?.address?.dynamicFields;
    if (!dfs) break;
    for (const node of dfs.nodes) {
      const isObj = node.value?.__typename === 'MoveObject';
      const repr = (isObj ? node.value?.contents?.type?.repr : node.value?.type?.repr) ?? '';
      const fields = (isObj ? node.value?.contents?.json : node.value?.json) ?? {};
      const m = repr.match(/::(bucket::Bucket|reservoir::Reservoir)<(.+)>$/);
      if (!m) continue;
      const kind = m[1];
      const inner = m[2].trim();
      const coinType = inner.startsWith('0x') ? inner : '0x' + inner;
      const rawAmount = String((fields as Record<string, unknown>).collateral_vault ?? (fields as Record<string, unknown>).pool ?? '0');
      const rawDecimals = Number((fields as Record<string, unknown>).collateral_decimal ?? 9);
      if (rawAmount !== '0') out.push({ kind, coinType, rawAmount, rawDecimals });
    }
    if (!dfs.pageInfo.hasNextPage || !dfs.pageInfo.endCursor) break;
    cursor = dfs.pageInfo.endCursor;
  }
  return out;
}

async function fetchPrices(coinTypes: string[]): Promise<Record<string, { price: number; decimals?: number; symbol?: string }>> {
  const out: Record<string, { price: number; decimals?: number; symbol?: string }> = {};
  // DefiLlama's /coins endpoint accepts up to ~100 ids per call comfortably.
  const chunks: string[][] = [];
  for (let i = 0; i < coinTypes.length; i += 50) chunks.push(coinTypes.slice(i, i + 50));
  for (const chunk of chunks) {
    const ids = chunk.map(c => `sui:${c}`).join(',');
    const r = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
    if (!r.ok) continue;
    const j = await r.json() as { coins: Record<string, { price?: number; decimals?: number; symbol?: string }> };
    for (const c of chunk) {
      const hit = j.coins?.[`sui:${c}`];
      if (hit?.price != null) out[c] = { price: hit.price, decimals: hit.decimals, symbol: hit.symbol };
    }
  }
  return out;
}

(async () => {
  console.log('Walking Bucket V1 dynamic fields…');
  const v1 = await fetchV1FieldsCoinTypes();
  console.log(`Found ${v1.length} V1 entries (buckets + reservoirs)\n`);

  console.log('Fetching V2 vaults via Bucket SDK…');
  const client = await BucketClient.initialize({ network: 'mainnet' });
  const vaults = await client.getAllVaultObjects();
  const v2 = Object.values(vaults).map(v => ({
    kind: 'v2-vault',
    coinType: v.collateralType,
    rawAmount: String(v.collateralBalance),
    rawDecimals: v.collateralDecimal,
  }));
  console.log(`Found ${v2.length} V2 vaults\n`);

  const all = [...v2, ...v1];
  const uniqueCoinTypes = Array.from(new Set(all.map(x => x.coinType)));
  console.log(`Total ${all.length} entries across ${uniqueCoinTypes.length} unique coin types\n`);

  console.log('Querying DefiLlama /coins/prices for all coin types…');
  const llamaPrices = await fetchPrices(uniqueCoinTypes);

  console.log('Querying Scallop indexer for sCoin prices…');
  const { fetchScallopSCoinPrices } = await import('../src/lib/prices');
  const scoinPriceMap = await fetchScallopSCoinPrices();
  const scoinPrices: Record<string, { price: number; symbol?: string; decimals?: number }> = {};
  for (const [k, v] of Object.entries(scoinPriceMap)) scoinPrices[k] = { price: v };
  const prices = { ...llamaPrices, ...scoinPrices };
  console.log(`  sCoin prices recovered: ${Object.keys(scoinPrices).length}\n`);
  const priced = uniqueCoinTypes.filter(c => prices[c]);
  const unpriced = uniqueCoinTypes.filter(c => !prices[c]);
  console.log(`  ✓ ${priced.length} priced by DefiLlama`);
  console.log(`  ✗ ${unpriced.length} NOT priced (LP tokens or unindexed)\n`);

  // Compute total USD by status
  let pricedUsd = 0, unpricedNominal = 0;
  for (const e of all) {
    const dec = e.rawDecimals;
    const raw = BigInt(e.rawAmount);
    const div = BigInt(10) ** BigInt(dec);
    const human = Number(raw / div) + Number(raw % div) / Number(div);
    const p = prices[e.coinType];
    if (p) pricedUsd += human * p.price;
    else unpricedNominal += human; // raw token count, no $ value yet
  }
  console.log(`Priced subset USD value: $${pricedUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`Unpriced raw token count (sum across all unpriced types): ${unpricedNominal.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`);

  console.log('─── PRICED COIN TYPES ───────────────────────────────────────');
  priced.sort((a, b) => (prices[b].price - prices[a].price));
  priced.forEach(c => {
    const p = prices[c];
    const tail = c.split('::').slice(-1)[0];
    console.log(`  $${p.price.toFixed(p.price > 1 ? 2 : 6).padStart(14)}  ${(p.symbol ?? tail).padEnd(20)} ${c.slice(0, 80)}`);
  });

  console.log('\n─── UNPRICED COIN TYPES (DefiLlama doesn\'t know these) ──────');
  unpriced.forEach(c => {
    // For unpriced, sum raw token count from all entries holding this type
    const heldBy = all.filter(e => e.coinType === c);
    const totalRaw = heldBy.reduce((s, e) => {
      const dec = e.rawDecimals;
      const raw = BigInt(e.rawAmount);
      const div = BigInt(10) ** BigInt(dec);
      return s + Number(raw / div) + Number(raw % div) / Number(div);
    }, 0);
    console.log(`  raw=${totalRaw.toFixed(2).padStart(14)}  in ${heldBy.length} entries  ${c.slice(0, 100)}`);
  });
})();
