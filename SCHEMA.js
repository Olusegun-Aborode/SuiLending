/*
═══════════════════════════════════════════════════════════════
SCHEMA — Sui Lending Dashboard
═══════════════════════════════════════════════════════════════
Pure docs. Describes the SHAPE of data the dashboard expects.
`data.js` exposes this as `window.SUI_LENDING_DATA`.

Extends the base Datum Labs SDK schema with two additions:
  1. `protocol` dimension on every pool, market and event row
  2. dedicated `liquidations` shape (richer than generic events)

────────────────────────────────────────────────────────────────
Protocol
────────────────────────────────────────────────────────────────
  { id, name, color, archetype }
    id         'navi' | 'suilend' | 'scallop' | 'alphalend' | 'bucket'
    archetype  'pool' | 'cdp'   — drives template choice on Rates page
    color      hex string for charts/chips

────────────────────────────────────────────────────────────────
Market (pool-archetype protocols: NAVI, Suilend, Scallop, AlphaLend)
────────────────────────────────────────────────────────────────
  Required:
    sym         string   ticker (SUI, USDC, USDT, ...)
    name        string   full asset name
    protocol    string   protocol.id
    supply      number   $M supplied
    borrow      number   $M borrowed
    supplyApy   number   %
    borrowApy   number   %
    util        number   % utilization
    risk        enum     'safe' | 'moderate' | 'high'
    spark       number[] 30 values for the row sparkline

  Optional (Protocol page drilldown):
    history          [{ day, supply, borrow }]   90d
    apyHistory       [{ day, supply, borrow }]   90d
    suppliers        number
    borrowers        number
    ltv              number   % loan-to-value
    liqThreshold     number   %
    reserveFactor    number   %
    supplyCap        number   token units
    borrowCap        number   token units
    oracleSource     string   'Pyth' | 'Switchboard' | 'Supra'
    irmKink          number   utilization where rate kinks (e.g. 80)
    irmBaseRate      number   %
    irmMultiplier    number   %
    irmJumpMult      number   %

────────────────────────────────────────────────────────────────
Vault (cdp-archetype: Bucket)
────────────────────────────────────────────────────────────────
  CDP protocols don't fit supply/borrow APY cleanly. Replace with:
    sym             string   collateral ticker (SUI, afSUI, ...)
    protocol        'bucket'
    collateralUsd   number   $M of collateral locked
    debtUsd         number   $M of stablecoin (USDB) outstanding
    interestRate    number   % annualized borrow cost
    redemptionFee   number   %
    psmFee          number   %  (PSM swap fee)
    minCR           number   %  (minimum collateral ratio)
    risk            'safe' | 'moderate' | 'high'
    spark           number[] 30 values

────────────────────────────────────────────────────────────────
Time series (per-protocol)
────────────────────────────────────────────────────────────────
  tvlSeries        per-protocol arrays of { day, value, protocol }
  tvlMetricSeries  { tvl | supply | borrow | revenue : tvlSeries }
  volumeSeries     [{ day, supply, borrow, liquid }]   protocol-aggregated
  kpiSparks        { [metric]: number[90] }
  protocolMetrics  per-protocol { id, tvl, supply, borrow, users, fees }

────────────────────────────────────────────────────────────────
Liquidations
────────────────────────────────────────────────────────────────
  liquidations  list of {
    t                  ISO ts
    protocol           protocol.id
    market             'SUI' | 'USDC' | ... (debt asset)
    debtAsset          ticker
    collateralAsset    ticker
    debtRepaidUsd      number
    collateralSeizedUsd number
    bonusUsd           number   liquidator profit
    liquidator         string   address (0x...abcd shortened)
    borrower           string   address
    txDigest           string   Sui tx digest
    healthFactor       number   HF at moment of liq (always < 1)
  }

  liquidationSeries  [{ day, count, totalRepaidUsd, byProtocol: { ... } }]

────────────────────────────────────────────────────────────────
Heatmap
────────────────────────────────────────────────────────────────
  7 × 24 matrix of values 0-1
  heatmapMetrics: { tx | volume | liquid : matrix }

────────────────────────────────────────────────────────────────
Ticker
────────────────────────────────────────────────────────────────
  { sym, price, ch, unit? }

────────────────────────────────────────────────────────────────
Risk tiers
────────────────────────────────────────────────────────────────
  safe      Safe      var(--green)
  moderate  Moderate  var(--yellow)
  high      High      var(--red)
*/

window.DATUM_RNG = function(seedValue) {
  if (seedValue == null) seedValue = 42;
  var s = seedValue;
  var rnd = function() { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  rnd.reset = function(v) { s = (v == null) ? seedValue : v; };
  return rnd;
};
