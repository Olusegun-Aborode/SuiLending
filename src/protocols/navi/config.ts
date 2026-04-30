import type { ProtocolConfig } from '../types';

/**
 * Static NAVI metadata — used for UI-facing concerns only (colors, display
 * names). Event parsers must NOT rely on the poolId → symbol mapping here;
 * use `getNaviPoolRegistry()` from ./poolRegistry instead, which pulls the
 * authoritative list from the NAVI open API (pools and their ids change
 * as NAVI adds new markets).
 */
const naviConfig: ProtocolConfig = {
  slug: 'navi',
  name: 'NAVI Protocol',
  shortName: 'NAVI',
  chain: 'sui',
  color: '#4DA2FF',
  explorerUrl: 'https://suiscan.xyz/mainnet/tx/',
  type: 'lending',

  // Keep this list in sync with the NAVI open API for UI purposes.
  // Order matches on-chain pool ids as of April 2026.
  assets: [
    { symbol: 'SUI',   name: 'Sui',                   color: '#4DA2FF', decimals: 9, poolId: 0,  coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI' },
    { symbol: 'wUSDC', name: 'Wormhole USDC',         color: '#2775CA', decimals: 6, poolId: 1,  coinType: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN' },
    { symbol: 'wUSDT', name: 'Wormhole USDT',         color: '#26A17B', decimals: 6, poolId: 2,  coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN' },
    { symbol: 'WETH',  name: 'Wrapped Ether',         color: '#627EEA', decimals: 8, poolId: 3,  coinType: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN' },
    { symbol: 'CETUS', name: 'Cetus',                 color: '#2E67F8', decimals: 9, poolId: 4,  coinType: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS' },
    { symbol: 'vSUI',  name: 'Volo Staked SUI',       color: '#9945FF', decimals: 9, poolId: 5,  coinType: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT' },
    { symbol: 'haSUI', name: 'Haedal Staked SUI',     color: '#00D4AA', decimals: 9, poolId: 6,  coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI' },
    { symbol: 'NAVX',  name: 'NAVI Token',            color: '#FF6B35', decimals: 9, poolId: 7,  coinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX' },
    { symbol: 'USDC',  name: 'USD Coin',              color: '#2775CA', decimals: 6, poolId: 10, coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' },
  ],

  pages: {
    overview: true,
    markets: true,
    wallets: true,
    liquidation: true,
    pools: false,        // DEX-only
  },

  features: {
    hasHealthFactor: true,
    hasLiquidations: true,
    hasInterestRateModel: true,
    hasIncentives: true,
    hasCollateralBorrowPairs: true,
  },
};

export default naviConfig;

// ─── NAVI-specific constants (used by cron jobs) ────────────────────────────

export const NAVI_LENDING_PACKAGE =
  '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb';

export const NAVI_EVENT_TYPES = {
  DEPOSIT: `${NAVI_LENDING_PACKAGE}::event::DepositEvent`,
  WITHDRAW: `${NAVI_LENDING_PACKAGE}::event::WithdrawEvent`,
  BORROW: `${NAVI_LENDING_PACKAGE}::event::BorrowEvent`,
  REPAY: `${NAVI_LENDING_PACKAGE}::event::RepayEvent`,
  LIQUIDATION_CALL: `${NAVI_LENDING_PACKAGE}::event::LiquidationCallEvent`,
  LIQUIDATION: `${NAVI_LENDING_PACKAGE}::event::LiquidationEvent`,
  STATE_UPDATED: `${NAVI_LENDING_PACKAGE}::event::StateUpdated`,
} as const;
