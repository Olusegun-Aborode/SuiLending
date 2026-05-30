/**
 * Risk modeling per §5 of the DeFi Lending Analysis Standard.
 *
 * Exports four things that the standard treats as the minimum bar for a
 * publishable risk dashboard:
 *
 *   1. Monte Carlo Loss-at-Risk (LaR) on collateral price paths driving
 *      per-market Health Factor → liquidation probability + expected timing
 *      + tail loss as a fraction of sector TVL.
 *
 *   2. VaR ensemble — Historical Simulation (robust baseline, no distribution
 *      assumptions) + a parametric heavy-tailed method (Student-t df=4) so
 *      the dashboard surfaces both an empirical and a fat-tail estimate at
 *      95% and 99% confidence.
 *
 *   3. Expected Shortfall (CVaR) at the same confidence levels alongside VaR.
 *
 *   4. Backtest violation rate — given a VaR estimated on the in-sample half
 *      of the return series, count how many out-of-sample daily returns
 *      breached it. A well-calibrated 95% VaR should breach ~5% of the time.
 *
 * Deliberate simplifications (documented in the on-page limitations panel):
 *
 *   • Per-position HF is not indexed for Sui lending markets. We use the
 *     per-market aggregate HF — (Σ collateralUsd × LT) / Σ debtUsd — as
 *     the unit of risk and treat each market as a single position. This
 *     under-states tail risk because a small subset of leveraged wallets
 *     can be liquidatable even when the market-aggregate HF is healthy.
 *
 *   • Single-factor GBM: all markets are driven by one common Brownian,
 *     calibrated to realized vol of sector TVL. Cross-asset correlation,
 *     stablecoin / SUI decoupling, and basis risk are absorbed into the
 *     single factor.
 *
 *   • Liquidation simulation assumes instant clearing at HF<1, no slippage,
 *     no oracle lag, no auction friction.
 *
 * The seed for the Monte Carlo RNG is fixed so the same payload yields the
 * same numbers across requests until the inputs change — important for
 * reproducible publication per §3 of the standard.
 */

// ─── PRNG: mulberry32 (deterministic, seedable) ────────────────────────────
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller standard normal generator built on a base uniform.
function makeNormal(rand: () => number): () => number {
  let cached: number | null = null;
  return () => {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = rand();
    while (u2 === 0) u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cached = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

// ─── Statistics primitives ─────────────────────────────────────────────────
function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / (xs.length - 1));
}

function quantileAsc(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const n = sortedAsc.length;
  const idx = q * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

/**
 * Daily log returns of a value series. Skips any pair where either value is
 * non-positive (a zero usually means "no data for that day" rather than a
 * real -100% return and would otherwise blow up the variance estimate).
 */
export function logReturns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

// ─── VaR / ES — Historical Simulation ──────────────────────────────────────
/**
 * Historical-simulation VaR at confidence `level` (e.g. 0.95).
 * Returns loss as a positive number: the negative of the (1-level)-quantile of returns.
 */
export function historicalVaR(returns: number[], level: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const q = quantileAsc(sorted, 1 - level);
  return Math.max(0, -q);
}

/**
 * Historical Expected Shortfall: mean of returns below the VaR threshold,
 * surfaced as a positive loss magnitude.
 */
export function historicalES(returns: number[], level: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  // Number of observations in the tail. At least 1 to avoid degenerate cases.
  const cutoff = Math.max(1, Math.floor(sorted.length * (1 - level)));
  const tail = sorted.slice(0, cutoff);
  const m = mean(tail);
  return Math.max(0, -m);
}

// ─── VaR / ES — Parametric Student-t (heavy-tail) ──────────────────────────
//
// Critical values for the standardized Student-t distribution with 4 degrees
// of freedom. df=4 is the canonical "heavy-tailed" choice that admits a
// finite variance but a meaningfully fatter tail than Gaussian. Empirical
// crypto returns typically have df in the 3-5 range; df=4 is a defensible
// middle. We hard-code the quantiles so we don't need a math library.
//
// Source: standard t-tables (e.g. Casella & Berger Appendix).
const T4_QUANTILES: Record<number, number> = {
  0.95: 2.132,
  0.99: 3.747,
};
// ES of standardized t_4 at the corresponding alpha. Derived analytically:
//   ES_α(t_v) = (v + t²_α) / (v - 1) · f(t_α) / (1 - α)
// where f is the t_v density. Pre-computed so the runtime stays cheap.
const T4_ES_RATIOS: Record<number, number> = {
  0.95: 2.873,
  0.99: 4.530,
};

/**
 * Parametric VaR assuming returns follow a Student-t (df=4) distribution
 * scaled by the sample standard deviation and centered on the sample mean.
 * Returns loss as a positive magnitude.
 */
export function parametricVaR(returns: number[], level: number): number {
  if (returns.length < 2) return 0;
  const mu = mean(returns);
  const sigma = stddev(returns);
  const t = T4_QUANTILES[level] ?? 2.132;
  return Math.max(0, -mu + sigma * t);
}

/** Parametric Expected Shortfall under the same Student-t (df=4) assumption. */
export function parametricES(returns: number[], level: number): number {
  if (returns.length < 2) return 0;
  const mu = mean(returns);
  const sigma = stddev(returns);
  const ratio = T4_ES_RATIOS[level] ?? 2.873;
  return Math.max(0, -mu + sigma * ratio);
}

// ─── Backtest ──────────────────────────────────────────────────────────────
export interface BacktestResult {
  level: number;
  expectedViolations: number;
  actualViolations: number;
  violationRate: number;
  expectedRate: number;
  observations: number;
  // Kupiec POF (proportion-of-failures) p-value, computed cheaply via the
  // likelihood-ratio statistic with a chi-squared(1) approximation. Lower
  // p-values mean the VaR is mis-calibrated. We return the LR statistic and
  // a coarse banding rather than the full CDF because the standard only
  // asks for "violation rate vs expected".
  kupiecLR: number;
}

/**
 * Backtest a given VaR against an out-of-sample return series. Returns the
 * count and rate of violations alongside the Kupiec likelihood-ratio.
 */
export function backtestVaR(returns: number[], level: number, varValue: number): BacktestResult {
  const n = returns.length;
  let x = 0;
  for (const r of returns) {
    if (-r > varValue) x++;
  }
  const p = 1 - level; // expected violation rate
  const pHat = n > 0 ? x / n : 0;
  // LR_POF = -2 ln( ((1-p)^(n-x) p^x) / ((1-pHat)^(n-x) pHat^x) )
  let lr = 0;
  if (n > 0 && x > 0 && x < n) {
    lr = -2 * (
      (n - x) * Math.log((1 - p) / (1 - pHat)) +
      x * Math.log(p / pHat)
    );
  }
  return {
    level,
    expectedViolations: n * p,
    actualViolations: x,
    violationRate: pHat,
    expectedRate: p,
    observations: n,
    kupiecLR: lr,
  };
}

// ─── Monte Carlo Loss-at-Risk ──────────────────────────────────────────────
export interface McMarketInput {
  protocol: string;
  sym: string;
  /** Supply (collateral) in USD millions. */
  supplyUsd: number;
  /** Borrow (debt) in USD millions. */
  borrowUsd: number;
  /** Aggregate market Health Factor today, or null when borrows are zero. */
  healthFactor: number | null;
}

export interface MonteCarloLaRResult {
  paths: number;
  horizonDays: number;
  /** P(total debt liquidated > 1% of sector TVL) over the horizon. */
  probOnePctLiquidated: number;
  /** 95th-percentile loss as a fraction of sector TVL. */
  laR95: number;
  /** 99th-percentile loss. */
  laR99: number;
  /** Mean loss across all paths (often dominated by the no-liquidation mode). */
  meanLoss: number;
  /** Conditional mean time-to-first-liquidation (days), among paths with any. */
  expectedTimingDays: number | null;
  /** Annualized vol used to seed the GBM. */
  assumedAnnualVol: number;
  /** Annualized drift used (typically 0 — conservative). */
  assumedAnnualDrift: number;
  /**
   * Binned distribution of simulated path losses, for the on-page histogram.
   * Each entry is [lossFractionBinLeft, count]. Range covers 0 … maxLoss
   * with 50 bins; outliers fold into the rightmost bin.
   */
  lossHistogram: Array<{ x0: number; x1: number; count: number }>;
  /** Share of paths with exactly zero liquidations (the "no-event" mode). */
  pathsWithZeroLoss: number;
}

export interface MonteCarloLaRInputs {
  markets: McMarketInput[];
  /** Total sector TVL in USD millions; denominator for loss fractions. */
  totalTvlUsdM: number;
  annualVol: number;
  annualDrift: number;
  horizonDays: number;
  paths: number;
  seed?: number;
}

/**
 * Run a Monte Carlo simulation of sector-wide collateral shocks and report
 * the distribution of TVL fraction liquidated over the horizon.
 *
 * Modelling choices documented at the top of this file. The simplest
 * configuration that still produces a meaningful tail: one shared Brownian
 * driving all markets, each market liquidates the moment its scaled HF
 * falls below 1, and the loss is the borrow on that market at t=0.
 */
export function monteCarloLaR(inputs: MonteCarloLaRInputs): MonteCarloLaRResult {
  const { markets, totalTvlUsdM, annualVol, annualDrift, horizonDays, paths, seed } = inputs;
  const rand = mulberry32(seed ?? 0xC0FFEE);
  const normal = makeNormal(rand);

  // Daily-step GBM. dt = 1 day.
  const mu = annualDrift / 365;
  const sigma = annualVol / Math.sqrt(365);
  const drift = mu - 0.5 * sigma * sigma;

  const losses: number[] = new Array(paths);
  let probOnePct = 0;
  const firstLiqDays: number[] = [];
  let lossSum = 0;

  // Pre-filter markets with debt + HF for the inner loop.
  const live = markets.filter(m => m.borrowUsd > 0 && m.healthFactor != null && m.healthFactor > 0);

  for (let p = 0; p < paths; p++) {
    let logPrice = 0;
    const liquidated = new Array<boolean>(live.length).fill(false);
    let pathLossUsdM = 0;
    let firstDay: number | null = null;

    for (let d = 1; d <= horizonDays; d++) {
      const z = normal();
      logPrice += drift + sigma * z;
      const mult = Math.exp(logPrice);
      for (let i = 0; i < live.length; i++) {
        if (liquidated[i]) continue;
        const m = live[i];
        const newHF = (m.healthFactor as number) * mult;
        if (newHF < 1) {
          liquidated[i] = true;
          pathLossUsdM += m.borrowUsd;
          if (firstDay == null) firstDay = d;
        }
      }
    }

    const lossFrac = totalTvlUsdM > 0 ? pathLossUsdM / totalTvlUsdM : 0;
    losses[p] = lossFrac;
    lossSum += lossFrac;
    if (lossFrac > 0.01) probOnePct++;
    if (firstDay != null) firstLiqDays.push(firstDay);
  }

  losses.sort((a, b) => a - b);

  // Binned loss distribution for the on-page histogram. 50 bins from 0 to
  // max observed loss (or a small floor so the chart isn't a single bar
  // when every path has zero loss). Path frequency at each bin lets the
  // frontend render the actual MC output rather than just summary stats.
  const maxObserved = losses[losses.length - 1] || 0.001;
  const nBins = 50;
  const binW = maxObserved / nBins;
  const lossHistogram: Array<{ x0: number; x1: number; count: number }> = [];
  for (let i = 0; i < nBins; i++) {
    lossHistogram.push({ x0: i * binW, x1: (i + 1) * binW, count: 0 });
  }
  let zeroLossPaths = 0;
  for (const lf of losses) {
    if (lf <= 0) { zeroLossPaths++; lossHistogram[0].count++; continue; }
    let idx = Math.floor(lf / binW);
    if (idx >= nBins) idx = nBins - 1;
    if (idx < 0) idx = 0;
    lossHistogram[idx].count++;
  }

  return {
    paths,
    horizonDays,
    probOnePctLiquidated: probOnePct / paths,
    laR95: quantileAsc(losses, 0.95),
    laR99: quantileAsc(losses, 0.99),
    meanLoss: lossSum / paths,
    expectedTimingDays: firstLiqDays.length ? mean(firstLiqDays) : null,
    assumedAnnualVol: annualVol,
    assumedAnnualDrift: annualDrift,
    lossHistogram,
    pathsWithZeroLoss: zeroLossPaths,
  };
}

// ─── Top-level orchestrator ────────────────────────────────────────────────
export interface VaRRow {
  level: number;
  historical: number;
  parametric: number;
  historicalES: number;
  parametricES: number;
}

export interface RiskModelOutput {
  /** VaR + ES at 95% and 99%, one row per level. */
  var: VaRRow[];
  /** Backtest results: in-sample VaR evaluated on the out-of-sample half. */
  backtest: BacktestResult[];
  /** Monte Carlo LaR summary. */
  monteCarlo: MonteCarloLaRResult;
  /** Realized vol diagnostics from the return series. */
  history: {
    observations: number;
    annualizedVol: number;
    annualizedReturn: number;
    minReturn: number;
    maxReturn: number;
  };
  /** Frozen list of model assumptions surfaced on-page. */
  limitations: string[];
  /** Model metadata for the panel footer. */
  meta: {
    seed: number;
    horizonDays: number;
    paths: number;
    confLevels: number[];
    distributions: string;
  };
}

const DEFAULT_LEVELS = [0.95, 0.99];

export interface RiskModelInputs {
  /** Sector-total TVL daily series (USD millions), ordered oldest → newest. */
  sectorTvlSeries: number[];
  /** Per-market inputs for the Monte Carlo simulation. */
  markets: McMarketInput[];
  /** Total sector TVL in USD millions. */
  totalTvlUsdM: number;
  /** Number of Monte Carlo paths. Default 5000 (≈10ms on Vercel). */
  paths?: number;
  /** Simulation horizon in days. Default 7. */
  horizonDays?: number;
  /** Override seed for reproducibility tests. */
  seed?: number;
}

export function computeRiskModel(inputs: RiskModelInputs): RiskModelOutput {
  const paths = inputs.paths ?? 5000;
  const horizonDays = inputs.horizonDays ?? 7;
  const seed = inputs.seed ?? 0xC0FFEE;

  const returns = logReturns(inputs.sectorTvlSeries);
  const annualizedVol = stddev(returns) * Math.sqrt(365);
  const annualizedReturn = mean(returns) * 365;
  const minReturn = returns.length ? Math.min(...returns) : 0;
  const maxReturn = returns.length ? Math.max(...returns) : 0;

  // VaR + ES ensemble at 95% and 99%.
  const varRows: VaRRow[] = DEFAULT_LEVELS.map((level) => ({
    level,
    historical: historicalVaR(returns, level),
    parametric: parametricVaR(returns, level),
    historicalES: historicalES(returns, level),
    parametricES: parametricES(returns, level),
  }));

  // Backtest: estimate VaR on the first half of the return series, count
  // violations on the second half. Standard "out-of-sample" check from the
  // Basel / Kupiec literature, the bare minimum the §5 standard asks for.
  const backtest: BacktestResult[] = DEFAULT_LEVELS.map((level) => {
    if (returns.length < 20) {
      return {
        level,
        expectedViolations: 0,
        actualViolations: 0,
        violationRate: 0,
        expectedRate: 1 - level,
        observations: 0,
        kupiecLR: 0,
      };
    }
    const split = Math.floor(returns.length / 2);
    const inSample = returns.slice(0, split);
    const outSample = returns.slice(split);
    const estVaR = historicalVaR(inSample, level);
    return backtestVaR(outSample, level, estVaR);
  });

  // Monte Carlo. Floor the annualized vol at 30% — a 90-day window that
  // happened to capture a quiet regime would otherwise produce an
  // implausibly low forward-looking risk number.
  const mcAnnualVol = Math.max(annualizedVol, 0.30);

  const mc = monteCarloLaR({
    markets: inputs.markets,
    totalTvlUsdM: inputs.totalTvlUsdM,
    annualVol: mcAnnualVol,
    annualDrift: 0, // assume zero drift — conservative for downside risk
    horizonDays,
    paths,
    seed,
  });

  const limitations = [
    'Per-position Health Factor is not indexed for Sui lending markets — we use the per-market aggregate HF as a proxy and treat each market as one position. This understates tail risk because leveraged wallets can be underwater while the market-aggregate HF still looks healthy.',
    'Single-factor GBM: all markets share one Brownian, calibrated to the realized vol of sector TVL. Cross-asset correlation, stablecoin vs SUI decoupling, and basis risk are absorbed into the single factor.',
    'Annualized vol is floored at 30% — a quiet 90-day window would otherwise produce an implausibly low forward-looking risk number.',
    'Parametric tail uses Student-t with df=4 (a defensible heavy-tail middle for crypto returns). Empirical kurtosis is not estimated.',
    'Liquidation simulation assumes instant clearing at HF<1, with no slippage, oracle lag, or auction friction. Realised liquidation losses can be larger.',
    'Backtest uses a single 50/50 in-sample / out-of-sample split rather than a rolling window — the return series is short (~90 days) so a rolling approach would have too few observations.',
  ];

  return {
    var: varRows,
    backtest,
    monteCarlo: mc,
    history: {
      observations: returns.length,
      annualizedVol,
      annualizedReturn,
      minReturn,
      maxReturn,
    },
    limitations,
    meta: {
      seed,
      horizonDays,
      paths,
      confLevels: DEFAULT_LEVELS,
      distributions: 'GBM (Monte Carlo) · Historical Simulation (VaR/ES) · Student-t df=4 (parametric VaR/ES)',
    },
  };
}
