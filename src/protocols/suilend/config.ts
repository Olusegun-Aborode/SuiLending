/**
 * Suilend Protocol configuration.
 *
 * Built by the Solend team. Pool-based lending on Sui. Uses Pyth as primary
 * oracle. Markets are called "reserves" in Suilend's terminology.
 *
 * Production lending market identifiers (from @suilend/sdk client.ts):
 *   LENDING_MARKET_ID:   0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1
 *   LENDING_MARKET_TYPE: 0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL
 *
 * The asset list below is for UI metadata only — the adapter discovers actual
 * reserves dynamically by parsing the on-chain LendingMarket object. Suilend
 * adds new reserves regularly so don't treat this list as authoritative.
 */

import type { ProtocolConfig } from '../types';

const suilendConfig: ProtocolConfig = {
  slug: 'suilend',
  name: 'Suilend',
  shortName: 'SUILEND',
  chain: 'sui',
  color: '#FF6B35',
  explorerUrl: 'https://suiscan.xyz/mainnet/tx/',
  type: 'lending',

  // Known reserves on the Suilend MAIN_POOL as of April 2026. The adapter
  // picks up everything live; this is just for asset colors / icons / metadata.
  assets: [
    { symbol: 'SUI',   name: 'Sui',                color: '#4DA2FF', decimals: 9, coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI' },
    { symbol: 'USDC',  name: 'USD Coin',           color: '#2775CA', decimals: 6, coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' },
    { symbol: 'USDT',  name: 'Tether',             color: '#26A17B', decimals: 6, coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN' },
    { symbol: 'WETH',  name: 'Wrapped Ether',      color: '#627EEA', decimals: 8, coinType: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN' },
    { symbol: 'WBTC',  name: 'Wrapped BTC',        color: '#F09242', decimals: 8, coinType: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN' },
    { symbol: 'sSUI',  name: 'SpringSui',          color: '#FF6B35', decimals: 9, coinType: '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI' },
    { symbol: 'haSUI', name: 'Haedal Staked SUI',  color: '#00D4AA', decimals: 9, coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI' },
    { symbol: 'afSUI', name: 'Aftermath SUI',      color: '#7C3AED', decimals: 9, coinType: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI' },
    { symbol: 'DEEP',  name: 'DeepBook Token',     color: '#005FCC', decimals: 6, coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP' },
    { symbol: 'WAL',   name: 'Walrus',             color: '#1A8FE3', decimals: 9, coinType: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL' },
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
    hasIncentives: true,           // Suilend has rewards via PoolRewardManager
    hasCollateralBorrowPairs: true,
  },
};

export default suilendConfig;

// ─── Suilend on-chain identifiers (used by adapter + cron jobs) ─────────────

export const SUILEND_LENDING_MARKET_ID =
  '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1';

export const SUILEND_LENDING_MARKET_TYPE =
  '0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL';

// Suilend Move package — used for filtering liquidation events
export const SUILEND_PACKAGE =
  '0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf';

export const SUILEND_EVENT_TYPES = {
  // Liquidation events use Suilend's standard liquidation type. The on-chain
  // event name is `LiquidateEvent` on the lending_market module (verify with
  // discover-events script before relying on this).
  LIQUIDATE: `${SUILEND_PACKAGE}::lending_market::LiquidateEvent`,
  DEPOSIT:   `${SUILEND_PACKAGE}::lending_market::DepositEvent`,
  WITHDRAW:  `${SUILEND_PACKAGE}::lending_market::WithdrawEvent`,
  BORROW:    `${SUILEND_PACKAGE}::lending_market::BorrowEvent`,
  REPAY:     `${SUILEND_PACKAGE}::lending_market::RepayEvent`,
} as const;
