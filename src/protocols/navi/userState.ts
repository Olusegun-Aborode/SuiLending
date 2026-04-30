/**
 * Per-address NAVI lending state.
 *
 * Fetches from BlockVision's DeFi Indexing API (`/v2/sui/account/defiPortfolio`)
 * which exposes per-address borrow / supply / rewards across all major Sui
 * lending protocols. Uses the same `BLOCKVISION_API_KEY` (defaults to the
 * URL-embedded key from `BLOCKVISION_SUI_RPC` for convenience) so no extra
 * env-var setup is needed.
 *
 * History: this file used to wrap `@naviprotocol/lending`'s `getLendingState`
 * + `getHealthFactor`, but that SDK's bundled dist imports old @mysten/sui v1
 * paths that don't exist in v2 (which Suilend SDK requires). BlockVision
 * gives us the same data over HTTP without the SDK churn.
 */

import { getNaviPoolRegistry } from './poolRegistry';

// Pull the BlockVision API key from either an explicit env var or the
// BlockVision RPC URL (which embeds it as the path's last segment).
function getBlockVisionKey(): string | null {
  if (process.env.BLOCKVISION_API_KEY) return process.env.BLOCKVISION_API_KEY;
  const rpc = process.env.BLOCKVISION_SUI_RPC;
  if (!rpc) return null;
  const m = rpc.match(/\/v1\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

interface BlockVisionAsset {
  coinType: string;
  symbol: string;
  value: number;       // USD-denominated
  apy?: string | number;
  logo?: string;
}

interface BlockVisionNaviResult {
  navi?: {
    borrow?: BlockVisionAsset[];
    supply?: BlockVisionAsset[];
    rewards?: BlockVisionAsset[];
  } | null;
}

export interface NaviUserAssetPosition {
  poolId: number;
  symbol: string;
  supplyUsd: number;
  borrowUsd: number;
}

export interface NaviUserState {
  address: string;
  healthFactor: number;
  collateralUsd: number;
  borrowUsd: number;
  collateralAssets: string[];
  borrowAssets: string[];
  perAsset: NaviUserAssetPosition[];
}

/**
 * Coarse Health Factor approximation.
 *
 * Real HF would weight each collateral asset by its on-chain liquidation
 * threshold and each debt asset by its borrow weight. NAVI's typical safe
 * threshold is ~0.85 for stables / SUI / LSTs and lower for volatile
 * assets. We use a flat 0.80 here as a conservative proxy — accurate enough
 * to bucket wallets into refresh-priority tiers (which is what the cron
 * actually uses HF for). A future pass could pull per-asset thresholds
 * from `PoolSnapshot.liquidationThreshold` and weight each leg.
 */
const COARSE_LIQ_THRESHOLD = 0.80;

function approximateHealthFactor(collateralUsd: number, borrowUsd: number): number {
  if (borrowUsd <= 0) return 999; // no debt = safe
  const weighted = collateralUsd * COARSE_LIQ_THRESHOLD;
  const hf = weighted / borrowUsd;
  return Number.isFinite(hf) ? hf : 999;
}

export async function fetchNaviUserState(address: string): Promise<NaviUserState> {
  const key = getBlockVisionKey();
  if (!key) {
    throw new Error(
      'NAVI userState requires BLOCKVISION_API_KEY (or BLOCKVISION_SUI_RPC with embedded key)',
    );
  }

  const url = `https://api.blockvision.org/v2/sui/account/defiPortfolio?address=${address}&protocol=navi`;
  const res = await fetch(url, { headers: { 'x-api-key': key } });
  if (!res.ok) throw new Error(`BlockVision DeFi portfolio HTTP ${res.status}`);

  const json = await res.json() as { code: number; result: BlockVisionNaviResult | null };
  const navi = json?.result?.navi;

  // BlockVision returns `navi: null` when the address has no NAVI activity at
  // all (closed positions, never used). Treat that as a zero state — the
  // index-wallets cron will record the wallet as inactive, which is accurate.
  if (!navi) {
    return {
      address,
      healthFactor: 999,
      collateralUsd: 0,
      borrowUsd: 0,
      collateralAssets: [],
      borrowAssets: [],
      perAsset: [],
    };
  }

  const supply = navi.supply ?? [];
  const borrow = navi.borrow ?? [];

  // Map BlockVision symbols → NAVI pool ids via our pool registry. If the
  // registry doesn't recognize a symbol (a new market BlockVision indexed
  // before we did), we still include it in the totals — just with poolId=-1.
  const registry = await getNaviPoolRegistry().catch(() => ({} as Record<number, { symbol: string; decimals: number; price: number }>));
  const poolIdBySymbol: Record<string, number> = {};
  for (const [poolIdStr, pool] of Object.entries(registry)) {
    poolIdBySymbol[(pool as { symbol: string }).symbol.toUpperCase()] = Number(poolIdStr);
  }

  const symbols = new Set<string>();
  for (const s of supply) symbols.add(s.symbol.toUpperCase());
  for (const b of borrow) symbols.add(b.symbol.toUpperCase());

  const perAsset: NaviUserAssetPosition[] = [];
  const collateralAssets: string[] = [];
  const borrowAssets: string[] = [];
  let totalCollateralUsd = 0;
  let totalBorrowUsd = 0;

  for (const sym of symbols) {
    const supEntry = supply.find((s) => s.symbol.toUpperCase() === sym);
    const borEntry = borrow.find((b) => b.symbol.toUpperCase() === sym);
    const supplyUsd = Number(supEntry?.value ?? 0);
    const borrowUsd = Number(borEntry?.value ?? 0);
    if (supplyUsd > 0) collateralAssets.push(sym);
    if (borrowUsd > 0) borrowAssets.push(sym);
    totalCollateralUsd += supplyUsd;
    totalBorrowUsd += borrowUsd;
    perAsset.push({
      poolId: poolIdBySymbol[sym] ?? -1,
      symbol: sym,
      supplyUsd,
      borrowUsd,
    });
  }

  return {
    address,
    healthFactor: approximateHealthFactor(totalCollateralUsd, totalBorrowUsd),
    collateralUsd: totalCollateralUsd,
    borrowUsd: totalBorrowUsd,
    collateralAssets,
    borrowAssets,
    perAsset,
  };
}

/**
 * Classify wallets into refresh buckets by health factor.
 *   0 = critical (HF < 1.1) — re-check every 2m
 *   1 = warning  (HF < 1.5) — re-check every 5m
 *   2 = normal   (HF < 3)   — re-check every 15m
 *   3 = safe     (HF ≥ 3)   — re-check every 60m
 */
export function healthToRefreshPriority(healthFactor: number): number {
  if (!Number.isFinite(healthFactor)) return 3;
  if (healthFactor < 1.1) return 0;
  if (healthFactor < 1.5) return 1;
  if (healthFactor < 3) return 2;
  return 3;
}
