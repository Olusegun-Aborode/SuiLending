/**
 * TEMPLATE — Protocol Adapter
 *
 * Implement the ProtocolAdapter interface to fetch and normalize
 * your protocol's data. The UI consumes NormalizedPool objects —
 * this adapter is responsible for converting protocol-specific
 * API responses into that common format.
 *
 * Steps:
 * 1. Implement fetchPools() to return all pools/markets
 * 2. Implement fetchPool(symbol) to return a single pool
 * 3. Optionally implement fetchLiquidations, fetchWalletPosition, discoverWallets
 * 4. Register in src/protocols/registry.ts
 */

import type { ProtocolAdapter, NormalizedPool } from '../types';

const templateAdapter: ProtocolAdapter = {
  async fetchPools(): Promise<NormalizedPool[]> {
    // TODO: Fetch pool data from your protocol's API or RPC
    //
    // Example:
    //   const res = await fetch('https://api.yourprotocol.io/pools');
    //   const data = await res.json();
    //   return data.pools.map(toNormalized);
    //
    return [];
  },

  async fetchPool(symbol: string): Promise<NormalizedPool | null> {
    // TODO: Fetch a single pool by symbol
    //
    // Simple approach: filter from fetchPools()
    const all = await this.fetchPools();
    return all.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
  },

  // Optional: Implement these for lending protocols with on-chain events
  //
  // async fetchLiquidations(cursor) { ... },
  // async fetchWalletPosition(address) { ... },
  // async discoverWallets() { ... },
};

export default templateAdapter;

/**
 * Helper to convert protocol-specific data to NormalizedPool.
 * Customize this based on your protocol's API response shape.
 */
// function toNormalized(raw: YourPoolType): NormalizedPool {
//   return {
//     symbol: raw.symbol,
//     decimals: raw.decimals,
//     totalSupply: raw.totalSupply,
//     totalSupplyUsd: raw.totalSupply * raw.price,
//     totalBorrows: raw.totalBorrows,
//     totalBorrowsUsd: raw.totalBorrows * raw.price,
//     availableLiquidity: raw.totalSupply - raw.totalBorrows,
//     availableLiquidityUsd: (raw.totalSupply - raw.totalBorrows) * raw.price,
//     supplyApy: raw.supplyRate,
//     borrowApy: raw.borrowRate,
//     utilization: raw.totalSupply > 0 ? (raw.totalBorrows / raw.totalSupply) * 100 : 0,
//     price: raw.price,
//   };
// }
