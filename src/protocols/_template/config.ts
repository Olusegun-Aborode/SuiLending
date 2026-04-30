/**
 * TEMPLATE — Protocol Configuration
 *
 * Copy this folder and rename it to your protocol slug (e.g. "suilend").
 * Fill in the config below and implement the adapter.
 * Then register your protocol in src/protocols/registry.ts.
 */

import type { ProtocolConfig } from '../types';

const templateConfig: ProtocolConfig = {
  slug: 'template',            // URL slug: /template/overview
  name: 'Template Protocol',   // Full display name
  shortName: 'TEMPLATE',       // Short nav name
  chain: 'sui',                // Blockchain
  color: '#888888',            // Brand color for charts
  explorerUrl: 'https://suiscan.xyz/mainnet/tx/',

  // Protocol type determines which pages are available
  type: 'lending', // 'lending' | 'dex' | 'perps'

  // Known assets — used for chart colors, pool ID mappings, etc.
  assets: [
    {
      symbol: 'SUI',
      name: 'Sui',
      color: '#4DA2FF',
      decimals: 9,
      poolId: 0,
      coinType: '0x2::sui::SUI',
    },
    // Add more assets...
  ],

  // Which pages to show in the nav
  pages: {
    overview: true,
    markets: true,
    wallets: true,          // Set false for DEX protocols
    liquidation: true,       // Set false for DEX protocols
    pools: false,            // Set true for DEX protocols
  },

  // Feature flags
  features: {
    hasHealthFactor: true,
    hasLiquidations: true,
    hasInterestRateModel: true,
    hasIncentives: false,
    hasCollateralBorrowPairs: true,
  },
};

export default templateConfig;
