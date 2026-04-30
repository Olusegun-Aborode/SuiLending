/**
 * Scallop Protocol adapter.
 *
 * Uses Scallop's hosted indexer at https://sui.apis.scallop.io (via
 * @scallop-io/sui-scallop-sdk's ScallopIndexer class). The indexer is HTTP-only —
 * no on-chain decoding, no Sui RPC calls — which makes this adapter the
 * fastest of the bunch.
 *
 * Why ScallopIndexer over ScallopQuery: Query does on-chain devInspect calls
 * which take ~5s each and can hit RPC limits. The indexer is pre-aggregated
 * and returns the same MarketPool shape with computed APYs, utilization, etc.
 *
 * Joining pools with collaterals: Scallop separates "pools" (assets you can
 * borrow) from "collaterals" (assets you can post). LTV / liquidationThreshold
 * live on collaterals. We merge them by coinType so each NormalizedPool gets
 * its risk params if the asset is also a collateral.
 */

import { ScallopIndexer } from '@scallop-io/sui-scallop-sdk';

import type { ProtocolAdapter, NormalizedPool, NormalizedLiquidation } from '../types';
import { SCALLOP_INDEXER_URL, SCALLOP_EVENT_TYPES } from './config';
import { tryFetchLiquidations } from '../_shared/liquidations';

// ─── Reserve filter ─────────────────────────────────────────────────────────
//
// Two-tier filter mirrors the Suilend approach:
//   1. Whitelist by coinType — gets canonical symbols
//   2. Dust threshold — surfaces real markets we haven't curated
const SCALLOP_WHITELIST_COINTYPES = new Set<string>([
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', // wUSDC
  '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN', // wUSDT
  '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN', // WETH
  '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN', // WBTC
  '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT', // vSUI
  '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
  '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
  '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA',
  '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
]);
const SCALLOP_MIN_TVL_USD = 250_000;

// CoinType → canonical symbol — same convention as Suilend adapter so the
// dashboard joins cleanly across protocols.
const CANONICAL_BY_COINTYPE: Record<string, string> = {
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': 'SUI',
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': 'USDC',
  '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT': 'USDT',
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': 'wUSDC',
  '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN': 'wUSDT',
  '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN': 'WBTC',
  '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN': 'WETH',
  '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS': 'CETUS',
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI': 'haSUI',
  '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI': 'afSUI',
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT': 'vSUI',
  '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI': 'sSUI',
  '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA': 'SCA',
  '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP': 'DEEP',
};

let _indexer: ScallopIndexer | null = null;
function getIndexer(): ScallopIndexer {
  if (!_indexer) _indexer = new ScallopIndexer({ indexerApiUrl: SCALLOP_INDEXER_URL });
  return _indexer;
}

const scallopAdapter: ProtocolAdapter = {
  async fetchPools(): Promise<NormalizedPool[]> {
    try {
      const market = await getIndexer().getMarket();
      const pools = Object.values(market.pools ?? {}).filter((p): p is NonNullable<typeof p> => !!p);
      const collaterals = market.collaterals ?? {};

      // Build coinType → collateral lookup for the LTV merge
      const collateralByCoinType: Record<string, NonNullable<typeof collaterals[string]>> = {};
      for (const c of Object.values(collaterals)) {
        if (c?.coinType) collateralByCoinType[c.coinType] = c;
      }

      const filtered = pools.filter((p) => {
        if (SCALLOP_WHITELIST_COINTYPES.has(p.coinType)) return true;
        // Use supplyCoin (human-readable), NOT supplyAmount (raw 10^decimal)
        const supplyUsd = (p.supplyCoin || 0) * (p.coinPrice || 0);
        return supplyUsd >= SCALLOP_MIN_TVL_USD;
      });

      return filtered.map((pool) => toNormalized(pool, collateralByCoinType[pool.coinType]));
    } catch (error) {
      console.error('[scallop.fetchPools]', error);
      return [];
    }
  },

  async fetchPool(symbol: string): Promise<NormalizedPool | null> {
    const all = await this.fetchPools();
    return all.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
  },

  /**
   * Best-effort liquidation indexer. Scallop's `LiquidateEvent` shape isn't
   * fully verified (couldn't confirm in-conversation due to RPC rate limits);
   * the parser below tries common field names and skips events it can't
   * parse. Returns successfully with `indexed: 0` if no events match.
   */
  async fetchLiquidations({ untilEventId, maxPages = 4 } = {}): Promise<NormalizedLiquidation[]> {
    return tryFetchLiquidations(SCALLOP_EVENT_TYPES.LIQUIDATE, {
      untilEventId,
      maxPages,
      decimals: SCALLOP_DECIMALS,
      symbols: CANONICAL_BY_COINTYPE,
    });
  },
};

const SCALLOP_DECIMALS: Record<string, number> = {
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': 9,
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC': 6,
  '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT': 6,
  '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN': 6,
  '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN': 6,
  '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN': 8,
  '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN': 8,
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI': 9,
  '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI': 9,
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT': 9,
  '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI': 9,
  '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS': 9,
  '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA': 9,
  '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP': 6,
};

export default scallopAdapter;

// ─── Helpers ────────────────────────────────────────────────────────────────

type Market = Awaited<ReturnType<ScallopIndexer['getMarket']>>;
type ScallopMarketPool = NonNullable<Market['pools'][string]>;
type ScallopMarketCollateral = NonNullable<Market['collaterals'][string]>;

/**
 * Resolve a symbol from Scallop's pool record. Prefers the canonical map
 * (wUSDC vs USDC vs sbUSDT — same trailing struct, different protocols), then
 * falls back to Scallop's `coinName` (e.g. "sbusdt" → "SBUSDT") which uniquely
 * identifies each reserve. Final fallback is the trailing struct name.
 */
function symbolFromPool(coinType: string, coinName: string | undefined): string {
  const known = CANONICAL_BY_COINTYPE[coinType];
  if (known) return known;
  if (coinName) {
    const cleaned = coinName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleaned) return cleaned.slice(0, 24);
  }
  const tail = (coinType.split('::').pop() ?? coinType).toUpperCase();
  return tail.slice(0, 24);
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toNormalized(p: ScallopMarketPool, collat?: ScallopMarketCollateral): NormalizedPool {
  const symbol = symbolFromPool(p.coinType, p.coinName);

  // Scallop's naming is reversed from intuition:
  //   `supplyAmount` / `borrowAmount` are RAW on-chain units (×10^decimals)
  //   `supplyCoin`   / `borrowCoin`   are SCALED human-readable coin amounts
  // Use the *Coin variants for token totals.
  const totalSupply        = num(p.supplyCoin);
  const totalBorrows       = num(p.borrowCoin);
  const availableLiquidity = totalSupply - totalBorrows;
  const price              = num(p.coinPrice);

  const totalSupplyUsd        = totalSupply * price;
  const totalBorrowsUsd       = totalBorrows * price;
  const availableLiquidityUsd = availableLiquidity * price;

  // Scallop's utilizationRate is already 0-100 in the indexer response — but
  // double-check by recomputing from amounts to be safe.
  const utilization = totalSupply > 0 ? (totalBorrows / totalSupply) * 100 : 0;

  // APYs are pre-computed by the indexer (decimals like 0.0421 = 4.21%)
  const supplyApy = num(p.supplyApy) * 100;
  const borrowApy = num(p.borrowApy) * 100;

  // Risk params: come from the matching collateral entry (if any). Pools that
  // are borrow-only (isolated assets) won't have a collateral — we leave LTV
  // and liquidation threshold at 0 in that case.
  const ltv                  = collat ? num((collat as { collateralFactor?: number }).collateralFactor) : 0;
  const liquidationThreshold = collat ? num((collat as { liquidationFactor?: number }).liquidationFactor) : 0;

  return {
    symbol,
    coinType: p.coinType,
    decimals: num(p.coinDecimal),
    totalSupply,
    totalSupplyUsd,
    totalBorrows,
    totalBorrowsUsd,
    availableLiquidity,
    availableLiquidityUsd,
    supplyApy,
    borrowApy,
    utilization,
    ltv,
    liquidationThreshold,
    supplyCapCeiling: num(p.maxSupplyCoin),
    borrowCapCeiling: num(p.maxBorrowCoin),
    optimalUtilization: num(p.midKink), // Scallop has two kinks; midKink is the practical "optimal"
    price,
  };
}
