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

export async function fetchNaviUserState(_address: string): Promise<NaviUserState> {
  // Throwing — see file-level comment. The index-wallets cron's catch
  // block bumps `lastUpdated` (so we don't hammer the function each cron
  // tick) without overwriting the legacy data. This preserves the 1,676
  // existing WalletPosition rows from before the consolidation deploy
  // until a v2-compatible NAVI position fetcher exists.
  throw new Error(
    'NAVI userState refresh disabled in this build — @naviprotocol/lending v1 ' +
    'is incompatible with @mysten/sui v2 (required by Suilend SDK). ' +
    'See protocols/navi/userState.ts for re-enable guidance.'
  );
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
