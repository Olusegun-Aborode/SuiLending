/**
 * AlphaLend Protocol configuration.
 *
 * AlphaFi's pool-based lending protocol on Sui. Uses AlphaFi's own oracle
 * (Pyth-derived) and stores markets as dynamic fields under a single
 * MARKETS_TABLE_ID. The adapter queries Sui's public GraphQL endpoint
 * directly — same approach as the official @alphafi/alphalend-sdk-js
 * (https://github.com/AlphaFiTech/alphalend-sdk-js) but without the SDK
 * itself, which is incompatible with @mysten/sui v2 (it imports
 * `@mysten/sui/graphql/schemas/latest`, a v1-only path).
 *
 * Asset list below is for UI metadata only — the adapter discovers actual
 * markets dynamically by paginating dynamic fields under MARKETS_TABLE_ID.
 *
 * Constant IDs sourced from:
 *   https://github.com/AlphaFiTech/alphalend-sdk-js/blob/main/src/constants/prodConstants.ts
 *   https://docs.alphafi.xyz/alphalend/developers/contract-and-object-ids
 */

import type { ProtocolConfig } from '../types';

const alphalendConfig: ProtocolConfig = {
  slug: 'alphalend',
  name: 'AlphaLend',
  shortName: 'ALPHA',
  chain: 'sui',
  color: '#00C896',
  explorerUrl: 'https://suiscan.xyz/mainnet/tx/',
  type: 'lending',

  assets: [
    { symbol: 'SUI',   name: 'Sui',                 color: '#4DA2FF', decimals: 9, coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI' },
    { symbol: 'USDC',  name: 'USD Coin',            color: '#2775CA', decimals: 6, coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' },
    { symbol: 'USDT',  name: 'Tether',              color: '#26A17B', decimals: 6, coinType: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT' },
    { symbol: 'wUSDT', name: 'Wormhole USDT',       color: '#26A17B', decimals: 6, coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN' },
    { symbol: 'haSUI', name: 'Haedal Staked SUI',   color: '#00D4AA', decimals: 9, coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI' },
    { symbol: 'afSUI', name: 'Aftermath SUI',       color: '#7C3AED', decimals: 9, coinType: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI' },
    { symbol: 'sSUI',  name: 'SpringSui',           color: '#FF6B35', decimals: 9, coinType: '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI' },
    { symbol: 'WAL',   name: 'Walrus',              color: '#1A8FE3', decimals: 9, coinType: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL' },
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

export default alphalendConfig;

// ─── AlphaLend on-chain identifiers ─────────────────────────────────────────

export const ALPHALEND_FIRST_PACKAGE =
  '0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4';

export const ALPHALEND_LATEST_PACKAGE =
  '0x15c16e76dfa8b42d3b0cbffea97fe5bd116853588e7fff0a5344deec89750885';

export const ALPHALEND_LENDING_PROTOCOL_ID =
  '0x01d9cf05d65fa3a9bb7163095139120e3c4e414dfbab153a49779a7d14010b93';

export const ALPHALEND_MARKETS_TABLE_ID =
  '0x2326d387ba8bb7d24aa4cfa31f9a1e58bf9234b097574afb06c5dfb267df4c2e';

// Liquidation events live on the FIRST package (which is the contract's
// permanent address). PositionCap struct also lives there.
export const ALPHALEND_EVENT_TYPES = {
  LIQUIDATE: `${ALPHALEND_FIRST_PACKAGE}::lending_protocol::LiquidationEvent`,
  DEPOSIT:   `${ALPHALEND_FIRST_PACKAGE}::lending_protocol::DepositEvent`,
  BORROW:    `${ALPHALEND_FIRST_PACKAGE}::lending_protocol::BorrowEvent`,
  REPAY:     `${ALPHALEND_FIRST_PACKAGE}::lending_protocol::RepayEvent`,
  WITHDRAW:  `${ALPHALEND_FIRST_PACKAGE}::lending_protocol::WithdrawEvent`,
} as const;

// Sui public GraphQL endpoint — the same one AlphaLend SDK uses by default.
export const SUI_GRAPHQL_URL =
  process.env.SUI_GRAPHQL_URL ?? 'https://graphql.mainnet.sui.io/graphql';
