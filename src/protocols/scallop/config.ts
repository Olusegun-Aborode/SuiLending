/**
 * Scallop Protocol configuration.
 *
 * "Next Generation Money Market for Sui." Pool-based lending with separate
 * collateral configs per asset. Uses Pyth as primary oracle, Switchboard as
 * fallback. The hosted Scallop indexer at https://sui.apis.scallop.io aggregates
 * on-chain state and serves pool/collateral data via REST.
 *
 * Asset list below is for UI metadata only — the adapter discovers actual
 * pools dynamically via ScallopIndexer.getMarket().
 */

import type { ProtocolConfig } from '../types';

const scallopConfig: ProtocolConfig = {
  slug: 'scallop',
  name: 'Scallop',
  shortName: 'SCALLOP',
  chain: 'sui',
  color: '#7B61FF',
  explorerUrl: 'https://suiscan.xyz/mainnet/tx/',
  type: 'lending',

  // Curated list — Scallop has many isolated/frontier markets; the adapter
  // surfaces the canonical ones plus any with non-trivial TVL.
  assets: [
    { symbol: 'SUI',   name: 'Sui',                 color: '#4DA2FF', decimals: 9, coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI' },
    { symbol: 'USDC',  name: 'USD Coin',            color: '#2775CA', decimals: 6, coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' },
    { symbol: 'USDT',  name: 'Tether',              color: '#26A17B', decimals: 6, coinType: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT' },
    { symbol: 'wUSDC', name: 'Wormhole USDC',       color: '#2775CA', decimals: 6, coinType: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN' },
    { symbol: 'wUSDT', name: 'Wormhole USDT',       color: '#26A17B', decimals: 6, coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN' },
    { symbol: 'WETH',  name: 'Wrapped Ether',       color: '#627EEA', decimals: 8, coinType: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN' },
    { symbol: 'WBTC',  name: 'Wrapped BTC',         color: '#F09242', decimals: 8, coinType: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN' },
    { symbol: 'CETUS', name: 'Cetus',               color: '#2E67F8', decimals: 9, coinType: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS' },
    { symbol: 'haSUI', name: 'Haedal Staked SUI',   color: '#00D4AA', decimals: 9, coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI' },
    { symbol: 'vSUI',  name: 'Volo Staked SUI',     color: '#9945FF', decimals: 9, coinType: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT' },
    { symbol: 'afSUI', name: 'Aftermath SUI',       color: '#7C3AED', decimals: 9, coinType: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI' },
    { symbol: 'sSUI',  name: 'SpringSui',           color: '#FF6B35', decimals: 9, coinType: '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI' },
    { symbol: 'SCA',   name: 'Scallop Token',       color: '#7B61FF', decimals: 9, coinType: '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA' },
    { symbol: 'DEEP',  name: 'DeepBook Token',      color: '#005FCC', decimals: 6, coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP' },
  ],

  pages: {
    overview: true,
    markets: true,
    wallets: true,
    liquidation: true,
    pools: false,
  },

  features: {
    hasHealthFactor: true,
    hasLiquidations: true,
    hasInterestRateModel: true,
    hasIncentives: true,
    hasCollateralBorrowPairs: true,
  },
};

export default scallopConfig;

// ─── Scallop on-chain identifiers (used by adapter + cron jobs) ─────────────

// Scallop's lending protocol package ID. Used to filter on-chain events for
// the index-liquidations cron. Verify with discover-events before relying on
// it — Scallop has shipped multiple package upgrades.
export const SCALLOP_PACKAGE =
  '0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c';

// Liquidation event type — confirm via discover-events; Scallop's docs name
// this as `LiquidateEvent` on the protocol module.
export const SCALLOP_EVENT_TYPES = {
  LIQUIDATE: `${SCALLOP_PACKAGE}::liquidate::LiquidateEvent`,
  DEPOSIT:   `${SCALLOP_PACKAGE}::deposit_collateral::CollateralDepositEvent`,
  WITHDRAW:  `${SCALLOP_PACKAGE}::withdraw_collateral::CollateralWithdrawEvent`,
  BORROW:    `${SCALLOP_PACKAGE}::borrow::BorrowEvent`,
  REPAY:     `${SCALLOP_PACKAGE}::repay::RepayEvent`,
} as const;

// Hosted SDK API base URL. The SDK defaults to this; we expose it so we can
// override via env var if Scallop ever migrates the production endpoint.
// Note: this is DIFFERENT from `sui.apis.scallop.io`, which is Scallop's
// open-source NestJS event indexer (no public API surface).
export const SCALLOP_INDEXER_URL =
  process.env.SCALLOP_INDEXER_URL ?? 'https://sdk.api.scallop.io';
