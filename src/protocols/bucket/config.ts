/**
 * Bucket Protocol configuration.
 *
 * Bucket is a Collateralized Debt Position (CDP) protocol on Sui — borrowers
 * deposit collateral, mint the USDB stablecoin against it, pay interest, and
 * are liquidated if their collateral ratio falls below the minimum.
 *
 * Differs from pool-based lenders: there's no "supplier APY" and no shared
 * liquidity pool. The NormalizedPool fields are mapped CDP-style:
 *   totalSupply      → collateral locked (token amount)
 *   totalSupplyUsd   → collateral locked ($)
 *   totalBorrows     → USDB issued against this collateral
 *   totalBorrowsUsd  → same (USDB ≈ $1)
 *   borrowApy        → interestRate (the rate borrowers pay)
 *   supplyApy        → 0 (depositing collateral doesn't earn yield)
 *   utilization      → usdbSupply / maxUsdbSupply (debt-cap utilization)
 *   ltv              → 1 / minCollateralRatio (max borrow vs collateral)
 *
 * On the dashboard's Rates page, Bucket renders via a CDP-specific row
 * template that surfaces redemption fee + min CR instead of supply APY.
 */

import type { ProtocolConfig } from '../types';

const bucketConfig: ProtocolConfig = {
  slug: 'bucket',
  name: 'Bucket',
  shortName: 'BUCKET',
  chain: 'sui',
  color: '#E5B345',
  explorerUrl: 'https://suiscan.xyz/mainnet/tx/',
  type: 'lending',

  assets: [
    { symbol: 'SUI',   name: 'Sui',                color: '#4DA2FF', decimals: 9, coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI' },
    { symbol: 'haSUI', name: 'Haedal Staked SUI',  color: '#00D4AA', decimals: 9, coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI' },
    { symbol: 'afSUI', name: 'Aftermath SUI',      color: '#7C3AED', decimals: 9, coinType: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI' },
    { symbol: 'sSUI',  name: 'SpringSui',          color: '#FF6B35', decimals: 9, coinType: '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI' },
    { symbol: 'WETH',  name: 'Wrapped Ether',      color: '#627EEA', decimals: 8, coinType: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN' },
    { symbol: 'WBTC',  name: 'Wrapped BTC',        color: '#F09242', decimals: 8, coinType: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN' },
    { symbol: 'USDC',  name: 'USD Coin',           color: '#2775CA', decimals: 6, coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' },
    { symbol: 'USDB',  name: 'Bucket USD',         color: '#E5B345', decimals: 9, coinType: '0xc63072e7f5f4983a2efaf5bdba1480d5e7d74d57948e1c7cc436f8e22cbeb410::buck::BUCK' },
  ],

  pages: {
    overview: true,
    markets: true,
    wallets: true,           // CDP positions per address
    liquidation: true,
    pools: false,
  },

  features: {
    hasHealthFactor: true,   // CR-based, not aggregate HF
    hasLiquidations: true,
    hasInterestRateModel: false, // CDP uses a flat interest rate per vault
    hasIncentives: true,        // rewardRate per vault
    hasCollateralBorrowPairs: false, // every position borrows USDB
  },
};

export default bucketConfig;

// Optional gRPC endpoint override. The SDK defaults to Sui's public gRPC if
// not set. BlockVision provides a gRPC-Web endpoint we can use here.
export const BUCKET_SUI_GRPC_URL =
  process.env.BLOCKVISION_SUI_GRPC_WEB ?? undefined;
