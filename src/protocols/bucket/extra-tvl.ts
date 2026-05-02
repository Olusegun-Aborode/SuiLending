/**
 * Bucket extra-TVL walks — the product surfaces beyond V1 CDPs and V2 vaults
 * that the @bucket-protocol/sdk doesn't enumerate cleanly. Direct on-chain
 * mirror of DefiLlama's bucket-protocol adapter (projects/bucket-protocol/
 * index.js as of 2026-05). Object IDs are quoted from there verbatim so the
 * audit trail is one-to-one — if DefiLlama's TVL diverges from ours, the
 * delta is in math or pricing, not in coverage.
 *
 * Surfaces covered here (not by adapter.ts's main pool walk):
 *
 *   1. PSM pools (USDC/USDT/FDUSD plus the LP-tokenized PSMs that hold
 *      BUCKETUS / BLUEFIN_STABLE_LP / CETABLE / STAPEARL).
 *   2. Fountain-staked LP "savings" pools (`output_volume`) — afSUI/vSUI/
 *      haSUI LST stakes plus Navi-protocol Ponds (CERT/STSUI/sbWBTC + SUI/
 *      haSUI ponds). This is the largest single bucket of missing TVL.
 *   3. Scallop / Navi sCoin saving wrappers (`coin_balance`) — wrappers
 *      around Scallop and Navi deposit receipts; their underlying is the
 *      coin you'd expect from the wrapper name.
 *   4. Aftermath BUCK pool stakes — Fountain-staked AF_LP for BUCK/USDC and
 *      BUCK/USDT pools. We compute LP value via pool ratio.
 *   5. KriyaDEX BUCK pool stakes — same shape as Aftermath but Kriya math.
 *   6. Cetus BUCKETUS Fountain — single staked-LP wrap, hardcoded 0.5/0.5
 *      USDC/BUCK split per DefiLlama's note.
 *   7. AFSUI/SUI Aftermath Bucket-V1 CDP — single CDP whose collateral is an
 *      AF_LP token; we unwrap via the AF pool state.
 *   8. gSUI / gUPUSD pipe redemption — Bucket "House" staked coins that
 *      redeem at `(pool + pipe_debt) / supply` of underlying.
 *
 * Returns a list of NormalizedPool rows. Each row gets a `BUCKET-EXTRA-...`
 * symbol prefix so it's recognisable in the dashboard and obviously not a
 * "real" lending pool.
 *
 * NOT covered here (deferred):
 *   • haSUI/SUI Cetus-CLMM vault (LP_TOKEN) — needs Uni-v3 tick math against
 *     the Cetus pool's `current_sqrt_price`. Real engineering, ~half day.
 *     Marked as a known gap; ~$5-10M of TVL.
 *   • Tank / Stability pool — DefiLlama explicitly skips these (line 240 of
 *     their adapter). We follow.
 */

import type { NormalizedPool } from '../types';
import { getObject, getMultipleObjects } from '@/lib/rpc';

// ─── Constants from DefiLlama's adapter ────────────────────────────────────

// Token coinTypes
const COIN = {
  SUI:         '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  BUCK:        '0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK',
  USDC:        '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', // wormhole USDC
  USDT:        '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN', // wormhole USDT
  USDC_CIRCLE: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  SUI_USDT:    '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT', // sui-bridge USDT
  FDUSD:       '0xf16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD',
  AFSUI:       '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
  VSUI:        '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
  HASUI:       '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
  STSUI:       '0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI',
  WBTC:        '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
} as const;

// PSM pool object IDs. Each holds `pool` (the deposited collateral) and
// `usdb_supply` (BUCK/USDB minted). For LP-tokenized PSMs (BUCKETUS,
// BLUEFIN_STABLE_LP, CETABLE, STAPEARL) we apply DefiLlama's hardcoded
// 50/50 split formula since their LP coins aren't priced by oracles.
const PSM_POOLS = {
  USDC_CIRCLE:        { id: '0xd22388010d7bdb9f02f14805a279322a3fa3fbde42896b7fb3d1214af404c455', kind: 'simple',  underlying: COIN.USDC_CIRCLE, decimals: 6 },
  USDC_WORMHOLE:      { id: '0x0c2e5fbfeb5caa4c2f7c8645ffe9eca7e3c783536efef859be03146b235f9e04', kind: 'simple',  underlying: COIN.USDC,        decimals: 6 },
  USDT_WORMHOLE:      { id: '0x607e7d386e29066b964934e0eb1daa084538a79b5707c34f38e190d64e24923e', kind: 'simple',  underlying: COIN.USDT,        decimals: 6 },
  FDUSD:              { id: '0xb23092f74b7bbea45056d8564a7325be993cc2926b89f384367b9ad309dd92c5', kind: 'simple',  underlying: COIN.FDUSD,       decimals: 6 },
  // LP-tokenized PSMs: half-split formulas per DefiLlama. The /1000 is
  // DefiLlama's hardcoded BUCK-decimals correction factor.
  BUCKETUS:           { id: '0xba86a0f37377844f38060a9f62b5c5cd3f8ba13901fa6c4ee5777c1cc535306b', kind: 'half_usdc_buck_kdiv', decimals: 6 }, // BUCKETUS = 0.5 USDC + 0.5 BUCK, /1000
  BLUEFIN_STABLE_LP:  { id: '0x27c3ec824df70520cb3cf9592049506167e8094a779a680b83b987519e3895b6', kind: 'half_usdc_buck_kdiv', decimals: 6 },
  CETABLE:            { id: '0x6e94fe6910747a30e52addf446f2d7e844f69bf39eced6bed03441e01fa66acd', kind: 'half_usdc_usdt',      decimals: 6 },
  STAPEARL:           { id: '0xccdaf635eb1c419dc5ab813cc64c728a9f5a851202769e254f348bff51f9a6dc', kind: 'half_usdc_usdt',      decimals: 6 },
} as const;

// Fountain-staked savings LPs. Read `output_volume`, value at the underlying
// asset's price. Largest single bucket of missing TVL.
const SAVING_LP_POOLS = {
  AFSUI_S:           { id: '0x508da82c0b6785653f638b95ebf7c89d720ecffae15c4d0526228a2edae7d429', underlying: COIN.AFSUI, decimals: 9 },
  VSUI_S:            { id: '0xa68124b518290f430f2133bcb679c519e51c99045e622cd6bcb00374c97f6d9d', underlying: COIN.VSUI,  decimals: 9 },
  HASUI_S:           { id: '0xa8993bf1c1e717b7c0f164c51346fa99a4e771c50d90c14e755adc48e39b7768', underlying: COIN.HASUI, decimals: 9 },
  NAVI_VSUI:         { id: '0xcbe804c8c334dcadecd4ba05ee10cffa54dad36f279ab4ec9661d67f9372881c', underlying: COIN.VSUI,  decimals: 9 },
  NAVI_STSUI:        { id: '0xd3f6b8f3c92d8f967f7e177e836770421e351b419ffe074ce57911365b4ede56', underlying: COIN.STSUI, decimals: 9 },
  NAVI_SBWBTC:       { id: '0x208628e8800828b272dfc4cf40ef98e1ba137f65d26a28961176a1718c2bdb4c', underlying: COIN.WBTC,  decimals: 8 },
  HASUI_NAVI_POND:   { id: '0xef1ff1334c1757d8e841035090d34b17b7aa3d491a3cb611319209169617518e', underlying: COIN.HASUI, decimals: 9 },
  SUI_NAVI_POND:     { id: '0xcf887d7201c259496a191348da86b4772a2e2ae3f798ca50d1247194e30b7656', underlying: COIN.SUI,   decimals: 9 },
} as const;

// Scallop/Navi sCoin saving wrappers. Read `coin_balance`. The "underlying"
// is what the wrapper credits to TVL — DefiLlama unwraps sCoins back to
// their underlying asset price, which is what we mirror here.
const SCOIN_SAVING_POOLS = {
  SCALLOP_USDC:               { id: '0x7b16192d63e6fa111b0dac03f99c5ff965205455089f846804c10b10be55983c', underlying: COIN.USDC,        decimals: 6 },
  SCALLOP_USDT:               { id: '0x6b68b42cbb4efccd9df30466c21fff3c090279992c005c45154bd1a0d87ac725', underlying: COIN.USDT,        decimals: 6 },
  SCALLOP_CIRCLE_USDC:        { id: '0xdf91ef19f6038e662e9c89f111ffe19e808cdfb891d080208d15141932f9513b', underlying: COIN.USDC_CIRCLE, decimals: 6 },
  SCALLOP_SUI_BRIDGE_USDT:    { id: '0x8471787fc69ef06f4762cb60863e1c48475d79c804a000e613306adee7b7824a', underlying: COIN.SUI_USDT,    decimals: 6 },
  NAVI_CIRCLE_USDC:           { id: '0xb5ed3f2e5c19f425baad3d9a0afffdc84d0550ace2372692cf93325da81e4392', underlying: COIN.USDC_CIRCLE, decimals: 6 },
  NAVI_SUI_BRIDGE_USDT:       { id: '0x4ae310b93c65e358b6f8beb73f34d0ac7d507947d8aea404159d19883a3b1c6a', underlying: COIN.SUI_USDT,    decimals: 6 },
  NAVI_FDUSD:                 { id: '0xa2790bbd90275e35214bffd8da3c01742bb5883fde861bf566a9ecfa1b3f5090', underlying: COIN.FDUSD,       decimals: 6 },
} as const;

// Aftermath BUCK pool Fountain stakes. The "staked" value is an LP balance
// in the underlying AF pool. To value, we read the pool's normalized_balances
// + lp_supply + decimal_scalars and apportion.
const AF_BUCK_LP_OBJS = [
  '0xe2569ee20149c2909f0f6527c210bc9d97047fe948d34737de5420fab2db7062',
  '0x885e09419b395fcf5c8ee5e2b7c77e23b590e58ef3d61260b6b4eb44bbcc8c62',
];
const AF_BUCK_POOL_OBJS = [
  '0xdeacf7ab460385d4bcb567f183f916367f7d43666a2c72323013822eb3c57026',
  '0xeec6b5fb1ddbbe2eb1bdcd185a75a8e67f52a5295704dd73f3e447394775402b',
];

// Kriya BUCK pool Fountain stakes. Similar shape but Kriya's LSP type is
// nested under .staked.lsp.balance and pool fields are token_x/token_y.
const KRIYA_LP_OBJS = [
  '0xcc39bcc2c438a79beb2656ff043714a60baf89ba37592bef2e14ee8bca0cf007',
  '0xae1910e5bcb13a4f5b12688f0da939b9c9d3e8a9e8d0a2e02c818f6a94e598fd',
];
const KRIYA_POOL_OBJS = [
  '0x3c334f9d1b969767007d26bc886786f9f197ffb14771f7903cd8772c46d08dea',
  '0xbb4a712b3353176092cdfe3dd2d1251b725f9372e954248e5dd2eb2ab6a5f21a',
];

// Cetus BUCKETUS Fountain — single object. Hardcoded 0.5 USDC + 0.5 BUCK
// per DefiLlama, with /1000 BUCK-decimals correction.
const CETUS_BUCKETUS_FOUNTAIN = '0xb9d46d57d933fabaf9c81f4fc6f54f9c1570d3ef49785c6b7200cad6fe302909';

// AFSUI/SUI Aftermath Bucket-V1 CDP. The CDP's collateral is an AF LP coin
// for the AFSUI/SUI pool — we unwrap via that pool's balances.
const AFSUI_SUI_LP_POOL = '0x97aae7a80abb29c9feabbe7075028550230401ffe7fb745757d3c28a30437408';
const AFSUI_SUI_LP_BUCKET = '0x1e88892e746708ec69784a56c6aba301a97e87e5b77aaef0eec16c3e472e8653';

// gSUI / gUPUSD pipe redemption — Bucket "House" coins. Pool fields shape:
// `{ pool, pipe_debt: { value }, supply: { value } }`. Redemption ratio:
// (pool + pipe_debt) / supply, then × held coin amount.
const GSUI_PIPE   = '0x811fe901ed2a5d75cd125912ad6110efdff8be00fe694601a94167e2bd545ac2';
const GUPUSD_PIPE = '0x13766a4d5c180f004f9bfd19e65f622fbb2b9498736131b948599054c0129f42';

// ─── Helpers ────────────────────────────────────────────────────────────────

type ObjFields = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  return fallback;
}

/**
 * Walk into nested `.fields.X` BCS-decoded objects. Sui's getObject returns
 * `content.fields` with primitive values inline, but nested structs come as
 * `{ fields: {...} }` requiring an extra `.fields` step. This walker hides
 * that quirk so callers can write `nested(obj, 'lp_supply', 'value')`.
 */
function nested(fields: ObjFields, ...path: string[]): unknown {
  let cur: unknown = fields;
  for (const k of path) {
    if (cur == null) return null;
    if (typeof cur !== 'object') return null;
    const cFields = (cur as { fields?: unknown }).fields;
    cur = cFields != null && typeof cFields === 'object' && k in (cFields as object)
      ? (cFields as Record<string, unknown>)[k]
      : (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function fieldsOf(obj: unknown): ObjFields | null {
  if (!obj || typeof obj !== 'object') return null;
  const data = (obj as { data?: { content?: { fields?: ObjFields } } }).data;
  return data?.content?.fields ?? null;
}

function bigIntDiv(raw: string | number, decimals: number): number {
  if (raw == null) return 0;
  const s = String(raw);
  if (!/^-?\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n / 10 ** decimals : 0;
  }
  const big = BigInt(s);
  const div = BigInt(10) ** BigInt(decimals);
  return Number(big / div) + Number(big % div) / Number(div);
}

function makeRow(symbol: string, coinType: string, amountUsd: number, decimals = 6): NormalizedPool {
  // Pseudo-pool rows for "TVL only" surfaces (PSM, savings, fountain stakes).
  // No borrow side, so totalBorrows* stay 0. The dashboard's tvl math is
  // `supply - borrow`, so totalSupplyUsd flows directly into protocol TVL.
  return {
    symbol,
    coinType,
    decimals,
    totalSupply: amountUsd,
    totalSupplyUsd: amountUsd,
    totalBorrows: 0,
    totalBorrowsUsd: 0,
    availableLiquidity: amountUsd,
    availableLiquidityUsd: amountUsd,
    supplyApy: 0,
    borrowApy: 0,
    utilization: 0,
    ltv: 0,
    liquidationThreshold: 0,
    supplyCapCeiling: 0,
    borrowCapCeiling: 0,
    optimalUtilization: 0,
    price: 1,
  };
}

// ─── Walk: PSM pools ────────────────────────────────────────────────────────

async function walkPsmPools(prices: Record<string, number>): Promise<NormalizedPool[]> {
  const ids = Object.values(PSM_POOLS).map(p => p.id);
  const objs = await getMultipleObjects(ids).catch((e) => {
    console.warn('[bucket.extra-tvl PSM]', e instanceof Error ? e.message : e);
    return [] as Awaited<ReturnType<typeof getMultipleObjects>>;
  });
  const byId = new Map(objs.map(o => [o.data?.objectId, o]));

  const rows: NormalizedPool[] = [];
  for (const [name, cfg] of Object.entries(PSM_POOLS)) {
    const obj = byId.get(cfg.id);
    const f = fieldsOf(obj);
    if (!f) continue;
    const poolRaw = num(f.pool);
    if (poolRaw <= 0) continue;
    const human = poolRaw / 10 ** cfg.decimals;

    if (cfg.kind === 'simple') {
      const price = prices[(cfg as typeof PSM_POOLS.USDC_CIRCLE).underlying] ?? 1;
      rows.push(makeRow(`BKT-PSM-${name}`, (cfg as typeof PSM_POOLS.USDC_CIRCLE).underlying, human * price, cfg.decimals));
    } else if (cfg.kind === 'half_usdc_buck_kdiv') {
      // BUCKETUS / BLUEFIN_STABLE_LP: 1 LP ≈ 0.5 BUCK + 0.5 USDC, with the
      // /1000 hardcoded BUCK-decimal correction. We credit only the USDC
      // half (BUCK is $1 but we don't double-count internal stablecoin).
      const usdcPrice = prices[COIN.USDC_CIRCLE] ?? 1;
      const halfUsdc = (poolRaw / 2) / 1000 / 1e6; // /1e6 = USDC decimals
      rows.push(makeRow(`BKT-PSM-${name}`, COIN.USDC_CIRCLE, halfUsdc * usdcPrice, 6));
    } else if (cfg.kind === 'half_usdc_usdt') {
      // CETABLE / STAPEARL: 1 LP ≈ 0.5 USDC + 0.5 USDT
      const usdcPrice = prices[COIN.USDC_CIRCLE] ?? 1;
      const usdtPrice = prices[COIN.USDT] ?? prices[COIN.SUI_USDT] ?? 1;
      const halfHuman = (poolRaw / 2) / 10 ** cfg.decimals;
      rows.push(makeRow(`BKT-PSM-${name}`, COIN.USDC_CIRCLE, halfHuman * (usdcPrice + usdtPrice), cfg.decimals));
    }
  }
  return rows;
}

// ─── Walk: Fountain LP savings (`output_volume`) ───────────────────────────

async function walkSavingLps(prices: Record<string, number>): Promise<NormalizedPool[]> {
  const ids = Object.values(SAVING_LP_POOLS).map(p => p.id);
  const objs = await getMultipleObjects(ids).catch((e) => {
    console.warn('[bucket.extra-tvl SavingLPs]', e instanceof Error ? e.message : e);
    return [] as Awaited<ReturnType<typeof getMultipleObjects>>;
  });
  const byId = new Map(objs.map(o => [o.data?.objectId, o]));

  const rows: NormalizedPool[] = [];
  for (const [name, cfg] of Object.entries(SAVING_LP_POOLS)) {
    const f = fieldsOf(byId.get(cfg.id));
    if (!f) continue;
    const raw = num(f.output_volume);
    if (raw <= 0) continue;
    const human = raw / 10 ** cfg.decimals;
    const price = prices[cfg.underlying] ?? 0;
    if (price <= 0) continue;
    rows.push(makeRow(`BKT-SAVE-${name}`, cfg.underlying, human * price, cfg.decimals));
  }
  return rows;
}

// ─── Walk: sCoin saving wrappers (`coin_balance`) ──────────────────────────

async function walkSCoinSavings(prices: Record<string, number>): Promise<NormalizedPool[]> {
  const ids = Object.values(SCOIN_SAVING_POOLS).map(p => p.id);
  const objs = await getMultipleObjects(ids).catch((e) => {
    console.warn('[bucket.extra-tvl sCoinSavings]', e instanceof Error ? e.message : e);
    return [] as Awaited<ReturnType<typeof getMultipleObjects>>;
  });
  const byId = new Map(objs.map(o => [o.data?.objectId, o]));

  const rows: NormalizedPool[] = [];
  for (const [name, cfg] of Object.entries(SCOIN_SAVING_POOLS)) {
    const f = fieldsOf(byId.get(cfg.id));
    if (!f) continue;
    const raw = num(f.coin_balance);
    if (raw <= 0) continue;
    const human = raw / 10 ** cfg.decimals;
    const price = prices[cfg.underlying] ?? 1; // stablecoins default to $1
    rows.push(makeRow(`BKT-SCOIN-${name}`, cfg.underlying, human * price, cfg.decimals));
  }
  return rows;
}

// ─── Walk: Aftermath BUCK Fountain stakes ──────────────────────────────────

async function walkAfBuckFountains(prices: Record<string, number>): Promise<NormalizedPool[]> {
  const [lpObjs, poolObjs] = await Promise.all([
    getMultipleObjects(AF_BUCK_LP_OBJS).catch(() => []),
    getMultipleObjects(AF_BUCK_POOL_OBJS).catch(() => []),
  ]);
  const rows: NormalizedPool[] = [];
  for (let i = 0; i < AF_BUCK_LP_OBJS.length; i++) {
    const fLp   = fieldsOf(lpObjs[i]);
    const fPool = fieldsOf(poolObjs[i]);
    if (!fLp || !fPool) continue;
    const staked = num(fLp.staked);
    const lpSupply = num(nested(fPool, 'lp_supply', 'value'));
    if (staked <= 0 || lpSupply <= 0) continue;

    const tokenNames = (fPool.type_names as string[] | undefined) ?? [];
    const balances = (fPool.normalized_balances as Array<string | number> | undefined) ?? [];
    const decimalScalars = (fPool.decimal_scalars as Array<string | number> | undefined) ?? [];

    let usd = 0;
    for (let j = 0; j < tokenNames.length; j++) {
      const token = '0x' + tokenNames[j];
      // Skip BUCK to avoid double-counting Bucket's own stablecoin
      if (token.endsWith('::buck::BUCK')) continue;
      const balance = num(balances[j]);
      const scalar = num(decimalScalars[j], 1);
      // value = (normalized_balance × staked / lp_supply) / decimal_scalar
      // matches DefiLlama's `Math.floor((v * staked) / lp_supply / decimal_scalars[i])`
      const tokenAmount = (balance * staked) / lpSupply / scalar;
      const price = prices[token] ?? 0;
      usd += tokenAmount * price;
    }
    if (usd > 0) rows.push(makeRow(`BKT-AF-FOUNTAIN-${i}`, COIN.BUCK, usd, 9));
  }
  return rows;
}

// ─── Walk: Kriya BUCK Fountain stakes ──────────────────────────────────────

async function walkKriyaBuckFountains(prices: Record<string, number>): Promise<NormalizedPool[]> {
  const [lpObjs, poolObjs] = await Promise.all([
    getMultipleObjects(KRIYA_LP_OBJS).catch(() => []),
    getMultipleObjects(KRIYA_POOL_OBJS).catch(() => []),
  ]);
  const rows: NormalizedPool[] = [];
  for (let i = 0; i < KRIYA_LP_OBJS.length; i++) {
    const fLp   = fieldsOf(lpObjs[i]);
    const fPool = fieldsOf(poolObjs[i]);
    const poolType = (poolObjs[i] as unknown as { data?: { content?: { type?: string } } })?.data?.content?.type ?? '';
    if (!fLp || !fPool) continue;
    // Kriya's staked balance is nested two levels: lp.staked.lsp.balance
    const staked = num(nested(fLp, 'staked', 'lsp', 'balance'));
    const lspSupply = num(nested(fPool, 'lsp_supply', 'value'));
    const tokenX = num(fPool.token_x);
    const tokenY = num(fPool.token_y);
    if (staked <= 0 || lspSupply <= 0) continue;

    // Pool type is `Pool<X, Y>` — extract token coinTypes.
    const m = poolType.match(/<\s*([^,]+)\s*,\s*([^>]+)>/);
    if (!m) continue;
    const x = m[1].trim().startsWith('0x') ? m[1].trim() : '0x' + m[1].trim();
    const y = m[2].trim().startsWith('0x') ? m[2].trim() : '0x' + m[2].trim();

    let usd = 0;
    if (!x.endsWith('::buck::BUCK')) {
      const xVal = (tokenX * staked) / lspSupply;
      const xDec = x === COIN.SUI ? 9 : x.includes('::usdc::') || x.includes('::usdt::') ? 6 : 9;
      usd += (xVal / 10 ** xDec) * (prices[x] ?? 0);
    }
    if (!y.endsWith('::buck::BUCK')) {
      const yVal = (tokenY * staked) / lspSupply;
      const yDec = y === COIN.SUI ? 9 : y.includes('::usdc::') || y.includes('::usdt::') ? 6 : 9;
      usd += (yVal / 10 ** yDec) * (prices[y] ?? 0);
    }
    if (usd > 0) rows.push(makeRow(`BKT-KRIYA-FOUNTAIN-${i}`, COIN.BUCK, usd, 9));
  }
  return rows;
}

// ─── Walk: Cetus BUCKETUS Fountain (single hardcoded 0.5/0.5/k) ────────────

async function walkCetusBucketusFountain(prices: Record<string, number>): Promise<NormalizedPool[]> {
  const obj = await getObject(CETUS_BUCKETUS_FOUNTAIN).catch(() => null);
  const f = fieldsOf(obj);
  if (!f) return [];
  const staked = num(f.staked);
  if (staked <= 0) return [];
  // 1 BUCKETUS = 0.5 BUCK + 0.5 USDC. We credit only the USDC half (skip
  // BUCK to avoid internal-stable double-counting). /1000 is DefiLlama's
  // hardcoded BUCK-decimals correction.
  const usdcPrice = prices[COIN.USDC_CIRCLE] ?? 1;
  const halfUsdc = (staked / 2) / 1000 / 1e6;
  const usd = halfUsdc * usdcPrice;
  return usd > 0 ? [makeRow('BKT-CETUS-BUCKETUS', COIN.USDC_CIRCLE, usd, 6)] : [];
}

// ─── Walk: AFSUI/SUI Aftermath Bucket-V1 CDP ───────────────────────────────

async function walkAfsuiSuiBucket(prices: Record<string, number>): Promise<NormalizedPool[]> {
  const [poolObj, bucketObj] = await Promise.all([
    getObject(AFSUI_SUI_LP_POOL).catch(() => null),
    getObject(AFSUI_SUI_LP_BUCKET).catch(() => null),
  ]);
  const fPool = fieldsOf(poolObj);
  const fBucket = fieldsOf(bucketObj);
  if (!fPool || !fBucket) return [];
  const lpSupply = num(nested(fPool, 'lp_supply', 'value'));
  const balances = (fPool.normalized_balances as Array<string | number> | undefined) ?? [];
  const tokenNames = (fPool.type_names as string[] | undefined) ?? [];
  const stakedInBucket = num(fBucket.collateral_vault);
  if (lpSupply <= 0 || stakedInBucket <= 0 || balances.length < 2) return [];

  // DefiLlama uses Math.floor on the percentages which truncates to 0 on
  // small ratios (lp_supply > balances). We avoid the floor and keep the
  // ratio in floating-point to capture small-but-non-zero positions.
  let usd = 0;
  for (let i = 0; i < balances.length && i < tokenNames.length; i++) {
    const token = '0x' + tokenNames[i];
    const balance = num(balances[i]);
    // Aftermath uses 1e18 normalization — undo for human-scale.
    const tokenAmt = (balance / 10 ** 18) * (stakedInBucket / lpSupply);
    const price = prices[token] ?? 0;
    usd += tokenAmt * price;
  }
  return usd > 0 ? [makeRow('BKT-AF-AFSUI-SUI', COIN.AFSUI, usd, 9)] : [];
}

// ─── (Deferred) gSUI / gUPUSD pipe redemption ──────────────────────────────
// Implemented for completeness. These values feed in only when V1 CDPs hold
// gSUI / gUPUSD as collateral. Without per-CDP unwrap logic in adapter.ts's
// V1 walk, these standalone reads contribute the *protocol's* pipe-asset
// reserves (not user-facing TVL), so we leave them off by default. If we
// wire them into the V1 CDP unwrap path, this helper is what to call.
export async function calcGSuiUnderlyingSui(gSuiAmount: number): Promise<number> {
  const f = fieldsOf(await getObject(GSUI_PIPE).catch(() => null));
  if (!f) return 0;
  const pool = num(f.pool);
  const pipe = num(nested(f, 'pipe_debt', 'value'));
  const supply = num(nested(f, 'supply', 'value'));
  if (supply <= 0) return 0;
  return ((pool + pipe) / supply) * gSuiAmount;
}
export async function calcGUpusdUnderlyingUsd(gUpusdAmount: number): Promise<number> {
  const f = fieldsOf(await getObject(GUPUSD_PIPE).catch(() => null));
  if (!f) return 0;
  const pool = num(f.pool);
  const pipe = num(nested(f, 'pipe_debt', 'value'));
  const supply = num(nested(f, 'supply', 'value'));
  if (supply <= 0) return 0;
  return ((pool + pipe) / supply) * gUpusdAmount;
}

// ─── Aggregator: all extra TVL ─────────────────────────────────────────────

/**
 * Walk every Bucket on-chain surface DefiLlama covers but the SDK doesn't
 * expose. Returns NormalizedPool rows ready to merge into the main pool list.
 *
 * `prices` should already include both DefiLlama prices and Scallop sCoin
 * prices (see adapter.ts where both are fetched). Anything we can't price
 * lands at $0 and shows up as a known gap rather than an inflated number.
 */
export async function fetchBucketExtraTvl(
  prices: Record<string, number>,
): Promise<NormalizedPool[]> {
  const [psm, savingLp, scoinSave, afFountain, kriyaFountain, cetusBucketus, afsuiSui] = await Promise.all([
    walkPsmPools(prices),
    walkSavingLps(prices),
    walkSCoinSavings(prices),
    walkAfBuckFountains(prices),
    walkKriyaBuckFountains(prices),
    walkCetusBucketusFountain(prices),
    walkAfsuiSuiBucket(prices),
  ]);
  return [...psm, ...savingLp, ...scoinSave, ...afFountain, ...kriyaFountain, ...cetusBucketus, ...afsuiSui];
}
