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
  liquidationFactor: {
    threshold: number;
  };
  borrowRateFactors: {
    fields: {
      optimalUtilization: string;
      base_rate?: string;
      multiplier?: string;
      jump_rate_multiplier?: string;
    };
  };
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

    return json.data.map((pool) => {
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

      // Caps & risk params (scaled by 1e27)
      const supplyCapCeiling = toFloat(pool.supplyCapCeiling, RAY);
      const borrowCapCeiling = toFloat(pool.borrowCapCeiling, RAY);
      const ltv = toFloat(pool.ltv, RAY);
      const optimalUtilization = toFloat(
        pool.borrowRateFactors?.fields?.optimalUtilization ?? '0',
        RAY
      );

      // IRM params — borrowRateFactors are RAY-scaled like rates, so divide
      // by RAY and ×100 to get percent. baseRate/multiplier/jump come from
      // the same factor block.
      const irm = pool.borrowRateFactors?.fields
        ? {
            baseRate:       toFloat(pool.borrowRateFactors.fields.base_rate ?? '0', RAY) * 100,
            multiplier:     toFloat(pool.borrowRateFactors.fields.multiplier ?? '0', RAY) * 100,
            jumpMultiplier: toFloat(pool.borrowRateFactors.fields.jump_rate_multiplier ?? '0', RAY) * 100,
            kink:           optimalUtilization,
            reserveFactor:  0, // NAVI's reserve factor isn't in this block; left at 0 for now
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
