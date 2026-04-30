/**
 * Per-address NAVI lending state.
 *
 * STUBBED in this consolidated repo. The original implementation called
 * `getLendingState` and `getHealthFactor` from `@naviprotocol/lending`, but
 * that SDK's bundled dist still imports `SuiClient` / `getFullnodeUrl` from
 * `@mysten/sui/client` — paths that no longer exist in @mysten/sui v2 (which
 * Suilend SDK requires). Turbopack's externals-tracing fails the build even
 * with `serverExternalPackages` set.
 *
 * Since the SuiLending dashboard's Overview / Protocol / Rates / Revenue /
 * Collateral / Liquidation pages don't depend on NAVI wallet-position data,
 * stubbing this file is the cleanest unblock. The `/api/navi/cron/index-wallets`
 * cron will return early; the existing 1,676 NAVI WalletPosition rows in the
 * DB stay queryable for the per-protocol Next.js dashboard at /navi/wallets.
 *
 * To re-enable: either find a v2-compatible @naviprotocol/lending build, or
 * call NAVI's open API + on-chain RPC directly here.
 */

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

export async function fetchNaviUserState(address: string): Promise<NaviUserState> {
  // Stubbed — see file-level comment for context. Returns an empty position
  // so callers don't crash; the index-wallets cron will see "no new data"
  // and skip the row.
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
