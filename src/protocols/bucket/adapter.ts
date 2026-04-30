/**
 * Bucket Protocol adapter.
 *
 * CDP — collateralized debt position. Each vault locks one collateral asset
 * and issues USDB against it. The SDK exposes vault state via
 * BucketClient.getAllVaultObjects() which returns one VaultInfo per
 * collateral type.
 *
 * Bucket SDK uses gRPC (`@mysten/sui/grpc`) instead of JSON-RPC. The default
 * gRPC fullnode is used unless BLOCKVISION_SUI_GRPC_WEB is set.
 */

import { BucketClient } from '@bucket-protocol/sdk';

import type { ProtocolAdapter, NormalizedPool, NormalizedLiquidation } from '../types';
import { BUCKET_SUI_GRPC_URL } from './config';
import { fetchSuiCoinPrices } from '@/lib/prices';
import { tryFetchLiquidations } from '../_shared/liquidations';

// Bucket V2 liquidation event lives on the CDP package. The latest CDP
// package ID changes on each upgrade — this is the current production one.
// If liquidations stop landing, recheck against the SDK's resolved config.
const BUCKET_LIQUIDATE_EVENT =
  '0xc63072e7f5f4983a2efaf5bdba1480d5e7d74d57948e1c7cc436f8e22cbeb410::cdp::LiquidateEvent';

// ─── CoinType → canonical symbol ────────────────────────────────────────────
const CANONICAL_BY_COINTYPE: Record<string, string> = {
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': 'SUI',
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI': 'haSUI',
  '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI': 'afSUI',
  '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI': 'sSUI',
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT': 'vSUI',
  '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN': 'WETH',
  '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN': 'WBTC',
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': 'USDC',
};

const BUCKET_MIN_TVL_USD = 100_000;
const USDB_DECIMALS = 6;

// ─── Adapter ────────────────────────────────────────────────────────────────

let _bucketClient: BucketClient | null = null;
async function getBucketClient(): Promise<BucketClient> {
  if (_bucketClient) return _bucketClient;
  // BUCKET_SUI_GRPC_URL is the gRPC-Web endpoint (e.g. BlockVision's). When
  // unset, the SDK uses the default public gRPC fullnode. We pass `network`
  // and let the SDK construct its own SuiGrpcClient.
  _bucketClient = await BucketClient.initialize({
    network: 'mainnet',
    ...(BUCKET_SUI_GRPC_URL ? { configOverrides: {} } : {}),
  });
  return _bucketClient;
}

const bucketAdapter: ProtocolAdapter = {
  async fetchPools(): Promise<NormalizedPool[]> {
    try {
      const client = await getBucketClient();

      // Fetch all three product surfaces in parallel
      const [vaults, psmPools, savingPools] = await Promise.all([
        client.getAllVaultObjects(),
        client.getAllPsmPoolObjects().catch(() => ({})),
        client.getAllSavingPoolObjects().catch(() => ({})),
      ]);

      // Collect all asset coinTypes that need USD pricing
      const coinTypes = [
        ...Object.values(vaults).map((v) => v.collateralType),
        ...Object.values(psmPools).map((p) => p.coinType),
      ];
      const prices = await fetchSuiCoinPrices(coinTypes);

      // Vault rows (CDP collateral)
      const vaultRows = Object.values(vaults).map((v) => toNormalized(v, prices));

      // PSM rows (1:1 collateral ↔ USDB swap pools — represent USDB-pegged TVL)
      const psmRows = Object.values(psmPools).map((p) => toPsmNormalized(p, prices));

      // Saving pool rows (USDB deposited earning yield)
      const savingRows = Object.values(savingPools).map((s) => toSavingNormalized(s));

      const all = [...vaultRows, ...psmRows, ...savingRows];

      // Filter dust — canonical coinTypes always pass; PSM/Saving rows always
      // pass since they represent named non-CDP product surfaces.
      return all.filter((p) => {
        if (CANONICAL_BY_COINTYPE[p.coinType ?? '']) return true;
        if (p.symbol.startsWith('PSM-') || p.symbol.startsWith('SAVING-')) return true;
        return p.totalSupplyUsd >= BUCKET_MIN_TVL_USD;
      });
    } catch (error) {
      console.error('[bucket.fetchPools]', error);
      return [];
    }
  },

  async fetchPool(symbol: string): Promise<NormalizedPool | null> {
    const all = await this.fetchPools();
    return all.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
  },

  /**
   * Best-effort liquidation indexer for Bucket V2 vault liquidations.
   * USDB is always the debt side; collateral asset varies per vault.
   * The shared parser handles common field names; Bucket-specific
   * decimals lookup helps scale collateral amounts correctly.
   */
  async fetchLiquidations({ untilEventId, maxPages = 4 } = {}): Promise<NormalizedLiquidation[]> {
    return tryFetchLiquidations(BUCKET_LIQUIDATE_EVENT, {
      untilEventId, maxPages,
      decimals: BUCKET_DECIMALS,
      symbols: CANONICAL_BY_COINTYPE,
    });
  },
};

// Decimals map for Bucket vault collateral assets. USDB is 6.
const BUCKET_DECIMALS: Record<string, number> = {
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': 9,
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI': 9,
  '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI': 9,
  '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI': 9,
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT': 9,
  '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN': 8,
  '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN': 8,
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': 6,
};

export default bucketAdapter;

// ─── Helpers ────────────────────────────────────────────────────────────────

type VaultInfo = Awaited<ReturnType<BucketClient['getAllVaultObjects']>>[string];
type PsmInfo   = Awaited<ReturnType<BucketClient['getAllPsmPoolObjects']>>[string];
type SavingInfo= Awaited<ReturnType<BucketClient['getAllSavingPoolObjects']>>[string];

function symbolFromCoinType(coinType: string): string {
  const known = CANONICAL_BY_COINTYPE[coinType];
  if (known) return known;
  const tail = (coinType.split('::').pop() ?? coinType).toUpperCase();
  return tail.slice(0, 24);
}

function bigToHuman(b: bigint, decimals: number): number {
  if (!b) return 0;
  // Avoid 2^53 overflow: split into integer and fractional parts via BigInt math.
  // Construct BigInt(10) ** BigInt(decimals) instead of `10n` literals so the
  // file compiles under target=ES2017.
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = Number(b / divisor);
  const frac = Number(b % divisor) / Number(divisor);
  return whole + frac;
}

function toNormalized(v: VaultInfo, prices: Record<string, number>): NormalizedPool {
  const coinType = v.collateralType;
  const symbol   = symbolFromCoinType(coinType);
  const decimals = v.collateralDecimal;
  const price    = prices[coinType] ?? 0;

  // CDP shape mapping (see config.ts header):
  //   totalSupply / totalSupplyUsd  → collateral locked
  //   totalBorrows / totalBorrowsUsd → USDB issued (≈ $1 per token)
  //   utilization                    → debt-cap utilization
  //   ltv                            → 1 / minCollateralRatio
  const collateralBalance = bigToHuman(v.collateralBalance, decimals);
  const totalSupplyUsd    = collateralBalance * price;
  // USDB has 6 decimals — verified by reverse-engineering CR from on-chain
  // values (e.g. SUI vault: 51K SUI collat at $0.91 ≈ $46K, against
  // raw usdbSupply 28,697,662,836; only USDB=6 yields a sensible 160% CR).
  const usdbSupply        = bigToHuman(v.usdbSupply, USDB_DECIMALS);
  const totalBorrowsUsd   = usdbSupply; // USDB ≈ $1
  const maxUsdb           = bigToHuman(v.maxUsdbSupply, USDB_DECIMALS);

  const utilization = maxUsdb > 0 ? Math.min(100, (usdbSupply / maxUsdb) * 100) : 0;

  // minCollateralRatio comes as a percent like 110 (i.e. 110%). Max LTV =
  // 1 / (minCR / 100) → 0.909 for 110%.
  const ltv = v.minCollateralRatio > 0 ? 100 / v.minCollateralRatio : 0;

  // borrowApy is the per-vault interest rate. SDK exposes a decimal — convert
  // to percent. supplyApy is N/A for CDP — set 0.
  const borrowApy = (v.interestRate || 0) * 100;
  const supplyApy = 0;

  return {
    symbol,
    coinType,
    decimals,
    totalSupply: collateralBalance,
    totalSupplyUsd,
    totalBorrows: usdbSupply,
    totalBorrowsUsd,
    availableLiquidity: Math.max(0, maxUsdb - usdbSupply), // remaining USDB cap
    availableLiquidityUsd: Math.max(0, maxUsdb - usdbSupply), // ≈ $1 each
    supplyApy,
    borrowApy,
    utilization,
    ltv,
    liquidationThreshold: ltv, // CDPs liquidate at min CR; use same value
    supplyCapCeiling: 0,        // CDP doesn't cap collateral deposit
    borrowCapCeiling: maxUsdb,  // cap on USDB issuance per vault
    optimalUtilization: 0,
    price,
  };
}

/**
 * PSM pool normalizer. PSM pools hold collateral (USDC, etc.) and mint USDB
 * 1:1 against it (with small swap fees). The "TVL" of a PSM is the asset
 * balance × asset price, which approximately equals usdbSupply (since PSM
 * is supposed to peg).
 *
 * Symbol convention: `PSM-<asset>` so the dashboard can distinguish PSM from
 * CDP rows in the same protocol bucket.
 */
function toPsmNormalized(p: PsmInfo, prices: Record<string, number>): NormalizedPool {
  const coinType = p.coinType;
  const baseSymbol = symbolFromCoinType(coinType);
  const symbol = `PSM-${baseSymbol}`.slice(0, 24);
  const decimals = p.decimal;
  const price = prices[coinType] ?? 1; // PSM is for stables; default to $1 if no feed

  const balance     = bigToHuman(p.balance, decimals);
  const usdbIssued  = bigToHuman(p.usdbSupply, USDB_DECIMALS);

  return {
    symbol,
    coinType,
    decimals,
    totalSupply: balance,
    totalSupplyUsd: balance * price,
    // For PSM, "borrow" is the USDB minted against the asset balance
    totalBorrows: usdbIssued,
    totalBorrowsUsd: usdbIssued,
    availableLiquidity: balance,
    availableLiquidityUsd: balance * price,
    supplyApy: 0,
    borrowApy: 0,
    utilization: 0,
    ltv: 1,                        // PSM is 1:1
    liquidationThreshold: 1,
    supplyCapCeiling: 0,
    borrowCapCeiling: 0,
    optimalUtilization: 0,
    price,
  };
}

/**
 * Saving pool normalizer. USDB deposited into a saving pool earns the
 * `savingRate`. We treat this as a savings-product row so the Bucket TVL
 * picture matches what DefiLlama shows.
 *
 * Symbol convention: `SAVING-USDB`.
 */
function toSavingNormalized(s: SavingInfo): NormalizedPool {
  const usdbBalance = bigToHuman(s.usdbBalance, USDB_DECIMALS);
  const cap = s.usdbDepositCap == null ? 0 : bigToHuman(s.usdbDepositCap, USDB_DECIMALS);

  return {
    symbol: 'SAVING-USDB',
    coinType: s.lpType,
    decimals: USDB_DECIMALS,
    totalSupply: usdbBalance,
    totalSupplyUsd: usdbBalance,        // ≈ $1 each
    totalBorrows: 0,
    totalBorrowsUsd: 0,
    availableLiquidity: usdbBalance,
    availableLiquidityUsd: usdbBalance,
    supplyApy: (s.savingRate || 0) * 100,
    borrowApy: 0,
    utilization: cap > 0 ? Math.min(100, (usdbBalance / cap) * 100) : 0,
    ltv: 0,
    liquidationThreshold: 0,
    supplyCapCeiling: cap,
    borrowCapCeiling: 0,
    optimalUtilization: 0,
    price: 1,
  };
}
