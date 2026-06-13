/**
 * NAVI Protocol data layer.
 *
 * Uses the official NAVI open API (https://open-api.naviprotocol.io/api/navi/pools)
 * — the same data source used by the NAVI SDK's getPoolInfo() function.
 *
 * The official SDK (src/libs/PoolInfo/index.ts) calls this API and then applies:
 *   - totalSupply / 1e9  (NOT per-asset decimals)
 *   - totalBorrow / 1e9
 *   - rates / 1e27  (Ray math)
 *   - ltv / 1e27
 *   - caps / 1e27
 *   - Multiply supply/borrow by their respective indexes to get real balances
 *
 * This file replicates that exact logic so our numbers match the official dashboard.
 */

import BigNumber from 'bignumber.js';

const NAVI_POOLS_API = 'https://open-api.naviprotocol.io/api/navi/pools';

// ─── Types for the NAVI Open API response ───────────────────────────────────

interface NaviApiPool {
  id: number;
  token: {
    symbol: string;
    coinType: string;
    decimals: number;
  };
  oracle: {
    price: number;
  };
  totalSupply: string;
  totalBorrow: string;
  currentSupplyIndex: string;
  currentBorrowIndex: string;
  currentSupplyRate: string;
  currentBorrowRate: string;
  supplyCapCeiling: string;
  borrowCapCeiling: string;
  ltv: string;
  /** Convenience decimal mirror of `ltv`, e.g. ltvValue=0.75 when ltv=7.5e26. */
  ltvValue?: number;
  liquidationFactor: {
    /**
     * NAVI API now returns `threshold` as a decimal string (e.g. "0.78").
     * Stay defensive and accept number too; we always wrap in `num()`.
     */
    threshold: number | string;
    /** Liquidation bonus, decimal (e.g. "0.08"). */
    bonus?: number | string;
    /** Close factor / max-repaid ratio, decimal (e.g. "0.35"). */
    ratio?: number | string;
  };
  borrowRateFactors: {
    fields: {
      optimalUtilization: string;
      base_rate?: string;
      multiplier?: string;
      jump_rate_multiplier?: string;
      /**
       * NAVI Open API returns reserveFactor as a RAY-scaled string in this
       * field. Our old code hardcoded reserveFactor: 0 — fixed 2026-05-31.
       * Field name on the API is camelCase `reserveFactor` even though the
       * sibling rate fields are snake_case.
       */
      reserveFactor?: string;
    };
  };
  /** Treasury cut RAY-scaled — used as a fallback proxy for reserveFactor. */
  treasuryFactor?: string;
  /** NAVI flags wound-down (e.g. Wormhole-wrapped) markets. Used to break
   *  same-symbol collisions in favour of the active market. */
  isDeprecated?: boolean;
  supplyIncentiveApyInfo: {
    boostedApr: number;
  };
  borrowIncentiveApyInfo: {
    boostedApr: number;
  };
}

interface NaviApiResponse {
  code: number;
  data: NaviApiPool[];
}

// ─── Our normalized pool type (consumed by API routes + frontend) ───────────

export interface NaviPoolData {
  symbol: string;
  poolId: number;
  coinType: string;
  decimals: number;
  totalSupply: number;       // human-readable token amount (with index applied)
  totalSupplyUsd: number;
  totalBorrows: number;      // human-readable token amount (with index applied)
  totalBorrowsUsd: number;
  availableLiquidity: number;
  availableLiquidityUsd: number;
  supplyApy: number;         // percentage
  borrowApy: number;         // percentage
  boostedSupplyApy: number;  // percentage (incentive APY)
  boostedBorrowApy: number;  // percentage (incentive APY)
  utilization: number;       // percentage
  ltv: number;               // decimal (e.g. 0.75 = 75%)
  liquidationThreshold: number; // decimal
  supplyCapCeiling: number;
  borrowCapCeiling: number;
  optimalUtilization: number; // decimal
  /** IRM params (RAY-descaled, percent units). Optional — present when
      borrowRateFactors are populated by NAVI's open API. */
  irm?: {
    baseRate: number;       // %
    multiplier: number;     // %
    jumpMultiplier: number; // %
    kink: number;           // decimal 0-1
    reserveFactor: number;  // decimal 0-1
  };
  price: number;
}

// ─── Scaling helpers (matching official SDK logic) ──────────────────────────

const RAY = new BigNumber(1e27);
const SUPPLY_BORROW_SCALE = new BigNumber(1e9);

function toFloat(value: string, divisor: BigNumber): number {
  return new BigNumber(value).dividedBy(divisor).toNumber();
}

// NAVI's open API returns several "numeric" fields as strings (price,
// liquidationFactor.threshold, boostedApr, …). Coerce at the boundary so
// downstream callers can assume `number`.
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert NAVI's raw rate to APY percentage.
 *
 * NAVI's currentSupplyRate / currentBorrowRate are already annualized
 * decimals scaled by 1e27 — so dividing by RAY and multiplying by 100
 * yields the APY in percent. (Compounding daily or annualizing per-second
 * produced absurd numbers on high-utilization pools.)
 */
function rateToApyPercent(rawRate: string): number {
  const apy = new BigNumber(rawRate).dividedBy(RAY).multipliedBy(100);
  return parseFloat(apy.toFixed(4));
}

/**
 * Collapse markets that share a token symbol down to one canonical market.
 *
 * NAVI lists multiple markets per asset (active LayerZero / Sui-bridge / native
 * plus wound-down Wormhole copies). Distinct symbols (e.g. "WBTC" vs "wBTC")
 * are fine and kept separate; the problem is genuine same-symbol duplicates,
 * where a deprecated market and an active one both report as "WBTC". Since the
 * rest of the stack identifies markets by (protocol, symbol), we keep only the
 * canonical one: prefer the non-deprecated market, then the larger book
 * (raw totalSupply). Deterministic regardless of API ordering.
 */
function dedupeBySymbol(pools: NaviApiPool[]): NaviApiPool[] {
  const best = new Map<string, NaviApiPool>();
  for (const p of pools) {
    const sym = p.token?.symbol;
    if (!sym) continue;
    const cur = best.get(sym);
    if (!cur) { best.set(sym, p); continue; }
    const activeGain = Number(!p.isDeprecated) - Number(!cur.isDeprecated);
    const better = activeGain !== 0
      ? activeGain > 0
      : Number(p.totalSupply ?? 0) > Number(cur.totalSupply ?? 0);
    if (better) best.set(sym, p);
  }
  return [...best.values()];
}

// ─── Main fetch functions ───────────────────────────────────────────────────

/**
 * Fetch all NAVI pool data from the official open API.
 * This is the same endpoint the NAVI SDK calls internally.
 */
export async function fetchAllPools(): Promise<NaviPoolData[]> {
  try {
    const res = await fetch(NAVI_POOLS_API, {
      next: { revalidate: 60 }, // cache 60s in Next.js
    });

    if (!res.ok) {
      console.error(`NAVI API returned ${res.status}`);
      return [];
    }

    const json: NaviApiResponse = await res.json();

    if (json.code !== 0 || !Array.isArray(json.data)) {
      console.error('NAVI API unexpected response:', json.code);
      return [];
    }

    // NAVI sometimes lists two markets under the same token symbol — e.g. an
    // active LayerZero "WBTC" (id 32) and a wound-down Wormhole "WBTC" (id 8,
    // isDeprecated). Everything downstream keys markets by (protocol, symbol),
    // so the duplicates collide in RateModelParams and the deprecated market's
    // params (LT 0.45, reserveFactor 0.98) clobber the active market's
    // (LT 0.70, reserveFactor 0.50) — yielding an impossible row where the
    // liquidation threshold sits below the LTV. Keep one market per symbol:
    // prefer the non-deprecated one, then the larger book.
    return dedupeBySymbol(json.data).map((pool) => {
      const symbol = pool.token.symbol;
      const price = num(pool.oracle?.price);
      const decimals = num(pool.token.decimals);

      // Match official SDK: divide raw amounts by 1e9, then multiply by index
      const rawSupply = toFloat(pool.totalSupply, SUPPLY_BORROW_SCALE);
      const supplyIndex = toFloat(pool.currentSupplyIndex, RAY);
      const totalSupply = rawSupply * supplyIndex;

      const rawBorrow = toFloat(pool.totalBorrow, SUPPLY_BORROW_SCALE);
      const borrowIndex = toFloat(pool.currentBorrowIndex, RAY);
      const totalBorrows = rawBorrow * borrowIndex;

      const availableLiquidity = totalSupply - totalBorrows;

      // Rates
      const supplyApy = rateToApyPercent(pool.currentSupplyRate);
      const borrowApy = rateToApyPercent(pool.currentBorrowRate);

      // Caps & risk params (scaled by 1e27).
      // NAVI exposes the decimal convenience `ltvValue` alongside the RAY-
      // scaled `ltv`. Prefer the decimal when present; fall back to the
      // RAY-scaled string. Belt and braces — if NAVI ever drops one or the
      // other this still produces a number.
      const supplyCapCeiling = toFloat(pool.supplyCapCeiling, RAY);
      const borrowCapCeiling = toFloat(pool.borrowCapCeiling, RAY);
      const ltv = typeof pool.ltvValue === 'number' && pool.ltvValue > 0
        ? pool.ltvValue
        : (pool.ltv ? toFloat(pool.ltv, RAY) : 0);
      const optimalUtilization = toFloat(
        pool.borrowRateFactors?.fields?.optimalUtilization ?? '0',
        RAY
      );

      // IRM params — borrowRateFactors are RAY-scaled like rates, so divide
      // by RAY and ×100 to get percent. baseRate/multiplier/jump come from
      // the same factor block. reserveFactor IS in this block (NAVI's open
      // API returns it as a camelCase `reserveFactor` field, RAY-scaled).
      // Our previous code hardcoded reserveFactor: 0 with a stale "not in
      // this block" comment — the field WAS always there, we just never
      // read it. Fixed 2026-05-31. We fall back to NAVI's `treasuryFactor`
      // (also RAY-scaled, on the pool root) when reserveFactor is missing,
      // since on-chain treasuryFactor is effectively the same governance
      // parameter under a different name on legacy markets.
      const rfField = pool.borrowRateFactors?.fields?.reserveFactor;
      const reserveFactor = rfField
        ? toFloat(rfField, RAY)
        : pool.treasuryFactor
          ? toFloat(pool.treasuryFactor, RAY)
          : 0;
      const irm = pool.borrowRateFactors?.fields
        ? {
            baseRate:       toFloat(pool.borrowRateFactors.fields.base_rate ?? '0', RAY) * 100,
            multiplier:     toFloat(pool.borrowRateFactors.fields.multiplier ?? '0', RAY) * 100,
            jumpMultiplier: toFloat(pool.borrowRateFactors.fields.jump_rate_multiplier ?? '0', RAY) * 100,
            kink:           optimalUtilization,
            reserveFactor,
          }
        : undefined;

      // Utilization
      const utilization = totalSupply > 0
        ? (totalBorrows / totalSupply) * 100
        : 0;

      return {
        symbol,
        poolId: pool.id,
        coinType: pool.token.coinType,
        decimals,
        totalSupply,
        totalSupplyUsd: totalSupply * price,
        totalBorrows,
        totalBorrowsUsd: totalBorrows * price,
        availableLiquidity,
        availableLiquidityUsd: availableLiquidity * price,
        supplyApy,
        borrowApy,
        boostedSupplyApy: num(pool.supplyIncentiveApyInfo?.boostedApr),
        boostedBorrowApy: num(pool.borrowIncentiveApyInfo?.boostedApr),
        utilization,
        ltv,
        liquidationThreshold: num(pool.liquidationFactor?.threshold),
        supplyCapCeiling,
        borrowCapCeiling,
        optimalUtilization,
        irm,
        price,
      };
    });
  } catch (error) {
    console.error('fetchAllPools error:', error);
    return [];
  }
}

/**
 * Fetch a single pool by symbol.
 */
export async function fetchSinglePool(
  symbol: string
): Promise<NaviPoolData | null> {
  const all = await fetchAllPools();
  return all.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}
