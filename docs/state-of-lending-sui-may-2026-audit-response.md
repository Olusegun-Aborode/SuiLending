# Revision history: State of Lending on Sui (May 2026)

## v0.2 (12 June 2026) — full rewrite against fresh data

After v0.1 was sent for external verification and a corrected version (v0.1.1) was prepared, a deeper data audit found that several headline figures in v0.1 had been written from a stale DefillamaTvl row. At the time v0.1 was drafted, the DefiLlama backfill had not yet landed late-May values, and the May 31 sector TVL row was carrying numbers closer to mid-May. The +17.2% growth narrative inherited that error; so did the per-protocol growth column, the HHI of 2,800, and the "five protocols held $523M" hero claim.

A fresh re-query against the now-current DefillamaTvl table (all 5 protocols, May 1 through 12 June, no gaps) produced different numbers. v0.2 is a full rewrite against those numbers. The narrative arc changed materially: the sector did not grow 17% in May, it peaked at $553M on 11 May and gave it all back, closing at $438.67M for a net 1.8% decline. The other numerical claims (composition, distinct liquidator counts, top liquidator concentration, market count, Bucket backing ratio basis) were also re-derived from source.

The two operational failures named in v0.1 (NAVI risk-parameter ingestion zeroed, DefiLlama backfill ran 15 days behind) are preserved in v0.2 in the same "What broke" section because the writing standard says we fix and name failures rather than relabel them. A third has been added: the v0.1 draft itself shipping against a stale row.

The data resilience layer that addresses the stale-row failure mode is now committed:
- Daily DefiLlama backfill cron at 02:00 UTC (`/api/cron/backfill-defillama`)
- Self-heal catch-up at 03:00 UTC scanning the last 14 days for gaps (`/api/cron/catch-up`)
- Public `/api/data-health` endpoint for external monitoring
- Operator runbook at `docs/data-resilience.md`

The two verification scripts that produced every number in v0.2 are committed at:
- `scripts/verify-report-claims.ts`
- `scripts/verify-may31-state.ts`

Both are idempotent. Any future re-publication should re-run them against current data before going out, not against numbers carried from a prior session.

## Changes from v0.1 to v0.2

### Headline and narrative

Prior: "$523M between them, grew 17% in May, 1,695 liquidations moved $1.9M."
New: "On 11 May the sector touched $553M. By 31 May it was at $438.67M, having given back every gain made in the first eleven days plus another 1.8% on top. 1,695 borrowers were liquidated on the way down, for $1.93M of repaid debt."
Reason: The +17.2% growth figure was an artefact of a stale DefillamaTvl row. The actual May trajectory is a fast rally and a slower drawdown, net negative.

### Per-protocol May trajectory

| Protocol  | v0.1 said | v0.2 says |
|-----------|-----------|-----------|
| NAVI      | +16.9%    | −1.61%    |
| Suilend   | +19.4%    | −4.37%    |
| Scallop   | +15.6%    | −1.08%    |
| AlphaLend | +20.0%    | −1.06%    |
| Bucket    | +10.5%    | +2.57%    |
| Sector    | +17.2%    | −1.80%    |

Reason: Recomputed against current DefillamaTvl values for 01 May and 31 May.

### Sector TVL on 31 May

Prior: $523.5M. New: $438.67M. Reason: same as above.

### HHI

v0.1: 2,800. v0.1.1 (external audit correction): 2,690. v0.2: **2,641**. Reason: HHI computed on the actual 31 May shares (NAVI 35.13, Suilend 30.81, AlphaLend 15.28, Bucket 14.29, Scallop 4.50). The audit's 2,690 used the report's wrong shares as input.

### NAVI + Suilend combined share

Prior: 67%. New: 65.9%. Reason: rounding on the corrected shares.

### Active market count

Prior: 165. New: 159. Reason: counted DISTINCT symbol per protocol in PoolSnapshot over the last 7 days (NAVI 34, Bucket 71, AlphaLend 20, Suilend 18, Scallop 16).

### Stablecoin borrow share

Prior: 28%. New: **46.7%**. Reason: recomputed from PoolSnapshot, summing `totalBorrowsUsd` where symbol ∈ {USDC, USDT, suiUSDT, wUSDC, wUSDT, USDsui, USDSUI, USDB, BUCK, AUSD, FDUSD, USDY, mUSD} as a fraction of total sector borrow ($98.9M of $211.7M).

### SUI + LST collateral share

Prior: 53%. New: **32.3%**. Reason: recomputed from PoolSnapshot, summing `totalSupplyUsd` where symbol ∈ {SUI, vSUI, haSUI, sSUI, afSUI, stSUI} as a fraction of total sector supply ($189.4M of $586.8M).

### Bucket backing ratio

Prior: "$67.5M collateral against $8.1M USDB, backing above 800%."
New: V2 USDB CDP vault collateral $6.53M, V2 USDB outstanding $1.96M, **backing ratio 333%**. PSM/Savings/V1 surfaces add a further $26.58M of collateral, taking total Bucket-tracked TVL to $33.12M, but those surfaces are not USDB-backing positions.
Reason: The v0.1 number conflated DefiLlama's whole-protocol Bucket TVL with the USDB issued; the 800% figure was the arithmetic ratio of those two values, but they refer to different collateral bases. The correct USDB-backing ratio uses only the V2 CDP vault collateral.

### Liquidator distinct counts

Prior: per-protocol 57 / 27 / 55 / 33 summing to 172, with "overlap likely".
New: per-protocol **54 / 27 / 52 / 29 summing to 162**, deduplicated sector-wide **150**, cross-protocol overlap **12** addresses.
Reason: The v0.1 per-protocol counts came from a query that did not apply the $1 filter to the COUNT(DISTINCT liquidator); sub-dollar bot addresses were inflating each protocol's distinct count.

### NAVI top liquidator concentration

Prior: "roughly 20% of events".
New: **33.2% (211 of 635 events)**.
Reason: re-derived from raw LiquidationEvent data, filtered for `debtUsd >= 1 OR collateralUsd >= 1`.

### Cross-protocol liquidation-threshold table

| Asset | Cell that changed | v0.1 said | v0.2 says |
|-------|------------------|-----------|-----------|
| SUI   | AlphaLend        | 85%       | 90% |
| USDC  | Scallop          | 80%       | 90% |
| USDC  | AlphaLend        | 80%       | 90% |
| USDT  | Scallop          | 80%       | 90% |
| USDT  | AlphaLend        | 80%       | 90% |
| WETH  | AlphaLend        | 60%       | removed (AlphaLend has no WETH market) |

Reason: re-derived from RateModelParams. Six cells in the v0.1 table were wrong.

### NAVI WBTC reserve factor

Prior: 98%. New: **98% (verified)**. Reason: confirmed from RateModelParams.

### NAVI borrow-only markets

Prior: AUSD, IKA, WETH, stBTC, wUSDC, wUSDT (six markets). New: **verified, exactly those six.** Reason: re-derived (RateModelParams rows with ltv=0 AND liquidationThreshold>0 for NAVI).

### Cadence in the week of 04 May

Prior: "one event per 30 minutes for a week".
v0.1.1 (audit correction): "one event every 22 minutes".
New: **one event every 22 minutes**. Reason: 464 events over the calendar week.

### Sub-$1 filter share

Prior: 35%. v0.1.1: 34%. New: **35%**. Reason: 35.0% on the current re-query (910 of 2,605 sub-$1 events). The two queries produced slightly different raw counts (2,584 in the first audit, 2,605 today), probably because more events ingested between the two runs.

### Sector supply-minus-borrow gap

Prior: "~$50M arithmetic gap".
v0.1.1: "$148.4M raw / $80.9M residual after Bucket" against the (wrong) $523.5M sector TVL.
New: **$63.6M raw / $30.4M residual after Bucket** against the correct $438.67M sector TVL.
Reason: gap recomputed against the correct sector TVL.

## Items unchanged from v0.1.1 to v0.2

The two operational-failure paragraphs are preserved verbatim, with one added paragraph naming the v0.1 stale-draft issue and the resilience layer that addresses it.

The voice rules from the Datum Labs Writing Standard apply throughout: British spelling, no em dashes (one slipped into a table cell in v0.2 first draft and was removed), no aphoristic endings, sentence-case headings, sources block pipe-separated at end, first person used as authority not filler, end first-person and specific.

## Lint state of v0.2

- Em dashes: 0 (one was caught in lint and removed)
- British spelling: preserved
- Word count: 3,127
- Heading style: sentence case throughout
- Hero opening leads with figures (553, 438.67, 1,695, 1.93)
- Close first-person and specific (NAVI liquidator concentration, stablecoin-borrow share trajectory, oracle failover documentation)
- Sources block: 11 entries, pipe-separated

## Recommended next step

Wire the verification scripts into CI per the external audit's Stage 4 recommendation. Any monthly report draft should refuse to publish unless `verify-report-claims.ts` and `verify-may31-state.ts` (renamed for the relevant month) reconcile against external second-confirmation paths (DefiLlama category, explorer event counts) within stated tolerance. This is the long-term fix for what happened to v0.1.
