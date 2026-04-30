/**
 * Per-address NAVI lending state.
 *
 * Wraps @naviprotocol/lending's getLendingState + getHealthFactor. Both go
 * on-chain via devInspectTransactionBlock under the hood — there is no NAVI
 * open-api for user positions (only pools/rewards/transactions).
 *
 * Returns human-friendly USD totals + per-asset breakdown for persistence in
 * the WalletPosition table.
 */

import BigNumber from 'bignumber.js';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { getLendingState, getHealthFactor } from '@naviprotocol/lending';
import { getNaviPoolRegistry } from './poolRegistry';

// v1→v2 migration note: @mysten/sui v2 renamed the user-facing client class
// from `SuiClient` (in `@mysten/sui/client`) to `SuiJsonRpcClient`
// (in `@mysten/sui/jsonRpc`). The constructor signature is unchanged.
// The bump to v2 was driven by @suilend/sdk's peer dependency.

const RPC_URL =
  process.env.BLOCKVISION_SUI_RPC ??
  process.env.ALCHEMY_SUI_RPC ??
  'https://fullnode.mainnet.sui.io:443';

/** getLendingState returns supply/borrowBalance as strings with 9-decimal precision. */
const BALANCE_SCALE = new BigNumber(10).pow(9);

let _client: SuiJsonRpcClient | null = null;
function getClient(): SuiJsonRpcClient {
  if (!_client) _client = new SuiJsonRpcClient({ url: RPC_URL, network: 'mainnet' });
  return _client;
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
  collateralAssets: string[]; // symbols with non-zero supply
  borrowAssets: string[];     // symbols with non-zero borrow
  perAsset: NaviUserAssetPosition[];
}

export async function fetchNaviUserState(address: string): Promise<NaviUserState> {
  const client = getClient();
  const registry = await getNaviPoolRegistry();

  const [state, rawHealth] = await Promise.all([
    getLendingState(address, { client }),
    getHealthFactor(address, { client }).catch(() => 999),
  ]);

  // Coerce non-finite (Infinity for zero-debt wallets, NaN, etc.) to a safe
  // sentinel so Prisma's Float column accepts it.
  const hfNum = Number(rawHealth);
  const healthFactor = Number.isFinite(hfNum) ? hfNum : 999;

  const perAsset: NaviUserAssetPosition[] = [];
  const collateralAssets: string[] = [];
  const borrowAssets: string[] = [];
  let totalCollateralUsd = 0;
  let totalBorrowUsd = 0;

  for (const pos of state) {
    const pool = registry[pos.assetId];
    if (!pool) continue; // unknown pool; skip rather than distort totals

    const supply = new BigNumber(pos.supplyBalance).dividedBy(BALANCE_SCALE).toNumber();
    const borrow = new BigNumber(pos.borrowBalance).dividedBy(BALANCE_SCALE).toNumber();
    const price = pool.price;

    const supplyUsd = supply * price;
    const borrowUsd = borrow * price;

    if (supplyUsd > 0) collateralAssets.push(pool.symbol);
    if (borrowUsd > 0) borrowAssets.push(pool.symbol);

    totalCollateralUsd += supplyUsd;
    totalBorrowUsd += borrowUsd;

    perAsset.push({
      poolId: pos.assetId,
      symbol: pool.symbol,
      supplyUsd,
      borrowUsd,
    });
  }

  return {
    address,
    healthFactor,
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
