# The State of Lending on Sui

**May 2026 · A Datum Labs report**

The Sui lending sector opened May at $446.73M of TVL and closed at $438.67M, a net 1.80% decline. The month was not flat. It was choppy, with four of the five protocols losing TVL and the fifth (Bucket, the CDP) holding within 3%. 1,695 borrowers were liquidated through the month for $1.93M of repaid debt, more than half of that concentrated in the single week of 04 May. The interesting question is not the closing number. It is whether the sector lost money or just lost SUI price, and how the four pool protocols and the one CDP responded to the same shock.

---

## How to read this

**What this covers.** The five materially significant Sui lending venues as of May 2026: NAVI, Suilend, Scallop, AlphaLend, and Bucket. NAVI, Suilend, Scallop and AlphaLend are pool-archetype protocols. Bucket is a CDP issuing USDB (its V2 stablecoin, alongside the legacy BUCK that still circulates separately). DefiLlama also lists smaller Sui lending entries (Current at roughly $10M, OmniBTC at roughly $2M) which we exclude on materiality grounds. Together the five named cover 159 active markets.

**What we measure and where it comes from.** Daily TVL through May comes from DefiLlama, which we pin as canonical for cross-protocol comparison because their per-protocol totals are calibrated against each protocol's own UI. Sector composition (supply, borrow, per-asset risk parameters, market counts) comes from each protocol's own on-chain state, indexed daily by our crons into PoolSnapshot and RateModelParams. Liquidation events come straight from Sui RPC and are filtered at $1 USD to drop sub-dollar micro-events that round to zero in display.

**What we do not measure.** Per-wallet positions are not indexed across all five protocols. Without them there is no honest health-factor distribution, no real liquidation probability, no per-borrower concentration. We removed those panels from the dashboard rather than ship a market-aggregate proxy that reads as risk and is in fact a utilisation ratio.

**Coverage caveats.** NAVI is the only protocol with full asset-level daily history for May. The other four have 16-18 days each at the per-asset granularity. Protocol-level trajectory comes from DefiLlama and is complete for every day May 1 through 31. Where this report goes deep at the market level, it goes deep on NAVI; for the other four we hold to protocol-level claims.

---

## Eight signals from the data

### 01 · Sector TVL closed May 1.8% below where it opened
**01 May: $446.73M. 31 May: $438.67M. Four of the five protocols lost TVL.**
The trajectory inside the month was choppy rather than monotonic. Reading May as a single growth or decline number misses that the sector was net flat-to-down for the first three weeks, took a sharper drop in the second half, and never recovered into month-end. Whether that decline reflects withdrawal of dollar capital or just SUI price moving most of the supply lower in USD terms is the question the per-protocol split below begins to answer.

### 02 · Every pool protocol retreated; only Bucket held
**Four of five protocols lost TVL in May. The fifth gained 2.57%, and it is the CDP.**
NAVI: $156.63M → $154.11M (-1.61%). Suilend: $141.31M → $135.13M (-4.37%). Scallop: $19.94M → $19.73M (-1.08%). AlphaLend: $67.73M → $67.01M (-1.06%). Bucket: $61.12M → $62.69M (+2.57%). The pool protocols hold collateral denominated in volatile assets, predominantly SUI and SUI-derivatives, and report TVL in dollars. A SUI price fall mechanically marks their TVL down even when nobody withdrew. Bucket's V2 collateral is locked into USDB-issuance positions; supply on a CDP is sticky in a way that supply on a pool lender is not.

### 03 · TVL share
**NAVI and Suilend hold 65.9% of Sui lending TVL.**
Per DefiLlama on 31 May: NAVI $154.11M (35.1%), Suilend $135.13M (30.8%), AlphaLend $67.01M (15.3%), Bucket $62.69M (14.3%), Scallop $19.73M (4.5%). A duopoly with three smaller venues, one of which is doing a different product altogether (the CDP).

### 04 · Liquidation volume
**1,695 positions were liquidated across the four pool protocols in May for $1.93M of repaid debt.**
NAVI: 635 events, $1.016M repaid. Scallop: 518 events, $0.247M. Suilend: 336 events, $0.555M. AlphaLend: 206 events, $0.115M. Bucket runs a Tank-based liquidation engine with full-collateral seizure alongside its redemption mechanism, but no Bucket liquidations were observed in May, which is what you would expect at the 333% backing ratio its V2 USDB vaults carried at month-end. The 1,695 figure is what survives a $1 filter. The raw event count is 2,605; 35% fell below the threshold and are sub-dollar bot interactions that should not be counted as liquidations.

### 05 · The week of 04 May was the entire story
**$1.028M of May's $1.93M repaid debt happened in a single week. The other three weeks split the rest.**
That week saw 464 events at an average of $2,216, which is one liquidation every 22 minutes for seven straight days. The week of 25 May had more events (690) but only $0.454M repaid at an average of $658. That is bots clearing dust positions, not stress. The week of 04 May is where the month's real distress concentrated; the rest of the month is liquidator MEV operating on small leftovers.

### 06 · NAVI runs the most concentrated liquidator market on Sui
**On NAVI, one liquidator address handled 211 of 635 events in May, or 33.2% of the protocol's flow.**
The next-largest concentration is AlphaLend's top address at 29.6% (61 of 206), then Scallop at 22.0% (114 of 518), then Suilend at 19.9% (67 of 336). NAVI's MEV market is not yet competitive; a single bot operator is doing one in three liquidations. The four protocols together produced 162 per-protocol-distinct liquidator addresses; the deduplicated sector-wide count is 150. Twelve addresses are operating on more than one protocol.

### 07 · Borrows are denominated in stablecoins; collateral is split across more assets than the narrative suggests
**Stablecoins are 46.7% of sector borrow, but SUI and its derivatives are only 32.3% of collateral.**
USDC, USDT, USDB, AUSD, BUCK and FDUSD together represent $98.9M of the $211.7M borrowed across the sector. The collateral side is more diversified than the typical "SUI lending market" story implies: SUI, vSUI, haSUI, sSUI and afSUI sum to $189.4M of the $586.8M supplied, with the remaining two-thirds spread across stablecoins (which are also supplied as collateral), BTC-class assets (WBTC, MBTC, LBTC, enzoBTC, stBTC) and a long tail of ecosystem tokens. The narrative "structurally long SUI, financed against stablecoins" understates the stablecoin side and overstates the SUI side.

### 08 · Borrow-only markets
**Six NAVI markets sit in the Isolated Markets tier with collateral-LTV of 0% and liquidation thresholds of 45-85%.**
AUSD, IKA, WETH, stBTC, wUSDC and wUSDT. NAVI launched its Isolated Markets framework in Q1 2026 as a separate parameter tier from the main pool. The same asset can appear with non-zero LTV in the main pool and 0% LTV in isolation. AUSD on Suilend can back a position at 77% LTV with 80% liquidation threshold; AUSD on NAVI cannot. Same asset, different rules. Aggregate cross-protocol "average LTV" comparisons are noisy for exactly this reason.

---

## Where the trajectory actually went

The endpoints are the safe statement: the sector opened May at $446.73M and closed at $438.67M, a net 1.80% decline. The daily DefillamaTvl values inside the month show a choppy pattern with one large single-day move on 11 May where every protocol jumped together by 7-15%, followed by a sustained slide for the back half of the month. We are not making a "peak and fade" claim out of that single-day spike, because we cannot anchor it against a separately-sourced SUI price reading and a one-day move that immediately reverses can be either a real volatility event or a third-party recomputation artefact. The honest read is: the month was not flat, the closing TVL is lower than the opening, and the weekly liquidation flow tells the more reliable story.

## Where the growth lives

| Protocol  | TVL 01 May | TVL 31 May | Change | Method |
|-----------|-----------:|-----------:|-------:|:-------|
| NAVI      | $156.63M   | $154.11M   | −1.61% | net (supply − borrow) |
| Suilend   | $141.31M   | $135.13M   | −4.37% | net (supply − borrow) |
| AlphaLend | $67.73M    | $67.01M    | −1.06% | net (supply − borrow) |
| Bucket    | $61.12M    | $62.69M    | +2.57% | remote (DefiLlama, LP unwrap) |
| Scallop   | $19.94M    | $19.73M    | −1.08% | remote (Scallop indexer) |
| **Sector**| **$446.73M**| **$438.67M**| **−1.80%** | mixed-method sum |

The "method" column matters. A cross-protocol TVL total sums non-identical things. NAVI, Suilend and AlphaLend publish a net liquidity figure on their own UIs. Scallop publishes a single canonical figure from its indexer. Bucket's number requires walking PSMs, savings vaults, sCoin wrappers and a fountain pool. Our headline matches each protocol's own UI; the sum is therefore directionally honest but does not equal supplied minus borrowed across the sector.

For the reader who wants the supplied-minus-borrowed view: sector supply on 31 May was $586.8M, sector borrow $211.7M. Subtraction gives $375.1M, against a headline TVL of $438.67M, a raw gap of $63.6M. Bucket's $33.2M of CDP collateral (counted in headline lending-sector TVL but sitting outside the four pool protocols' supply/borrow accounting) explains $33.2M of that. The residual $30.4M reflects LST double-count exclusions, non-pool collateral surfaces, and small timing differences between the daily TVL snapshot and the supply/borrow read.

## Who liquidated whom

| Protocol  | Events | Debt repaid | Avg size | Distinct liquidators | Top liquidator share |
|-----------|-------:|------------:|---------:|---------------------:|---------------------:|
| NAVI      | 635    | $1.016M     | $1,600   | 54                   | 33.2% |
| Scallop   | 518    | $0.247M     | $477     | 27                   | 22.0% |
| Suilend   | 336    | $0.555M     | $1,651   | 52                   | 19.9% |
| AlphaLend | 206    | $0.115M     | $560     | 29                   | 29.6% |

NAVI carried 37% of May's events and 53% of the debt repaid, which tracks its position as the largest borrow-side venue. Scallop produced 31% of events but only 13% of dollars; its average liquidation size was $477. Suilend's average was $1,651, more than three times Scallop's. The same asset (SUI, USDC, BTC) gets liquidated very differently depending on which protocol the borrower picked.

Liquidator concentration is the more interesting cross-protocol number. NAVI's top liquidator did one in three of NAVI's events. AlphaLend's top did roughly three in ten. Suilend and Scallop are more diffuse, with no single bot dominating. The 162 per-protocol-distinct liquidator addresses deduplicate to 150 sector-wide. Twelve addresses are operating on multiple protocols, which is what you would expect of MEV operators chasing the cheaper bonus.

## How the rate models actually look

Liquidation thresholds for the five most-borrowed assets, as of end of May:

| Asset | NAVI | Suilend | Scallop | AlphaLend |
|-------|-----:|--------:|--------:|----------:|
| SUI   | 80% | 75% | 90% | 90% |
| USDC  | 85% | 80% | 90% | 90% |
| USDT  | n/a | n/a | 90% | 90% |
| WBTC  | 45% | 65% | 80% | 85% |
| WETH  | 80% | 75% | 80% | n/a |

Scallop and AlphaLend run the most aggressive thresholds on the stable side (90% on USDC and USDT), where NAVI sits at 85% and Suilend at 80%. On WBTC the pattern inverts: AlphaLend at 85%, Scallop at 80%, Suilend at 65%, NAVI at 45%. NAVI's 45% WBTC liquidation threshold is unusually low and lower than its 65% LTV on the same asset, which is its own configuration choice and means the protocol effectively discourages borrowing against WBTC. The 98% reserve factor NAVI runs on WBTC reinforces that: borrowers fund nearly all interest back to the protocol, suppliers earn very little, the market exists mostly to be technically supported. Each protocol is making a structural bet here, and the bets do not align.

Suilend has no native USDT or NAVI-style USDT market; it lists wUSDT, which sits in a different parameter tier. NAVI's USDT exposure runs through wUSDT and suiUSDT, both of which sit in the Isolated Markets borrow-only tier described above.

## Concentration the dashboard would flag

**Oracle.** Pyth is the primary feed across every Sui lending venue. NAVI documents a Pyth-plus-Supra dual source. Scallop's xOracle layer integrates Pyth, Switchboard and Supra. Suilend's architecture references Pyth and Switchboard. AlphaLend is Pyth-only. The risk is not that no protocol has a secondary, it is that we cannot tell from public documentation how those secondaries are weighted, what staleness thresholds trigger failover, or whether any of them contributes to price formation in normal operation rather than only on Pyth fallback. A bad Pyth quote during the next material move would not produce identical behaviour across the five, but it would still drive most of the sector's pricing. The honest correction for the lending sector is not "add a second oracle"; three of five already have one. The honest correction is to publish failover rules and weights, so the failure mode can be reasoned about.

**Asset.** Stablecoins are 46.7% of sector borrows. SUI and SUI-derivative collateral are 32.3% of sector supply. The asymmetry says the sector is short stablecoins against a mixed collateral base, of which SUI is the single largest component but not a majority. A SUI drawdown remains the most consequential single move because it hits a third of supply directly, but the report does not survive the claim that the sector is "mostly SUI". It is structurally diversified on the supply side and stablecoin-dominated on the borrow side.

**Protocol.** NAVI and Suilend hold 65.9% of TVL. A failure at either takes more value off the sector chart than the smallest three combined. The Herfindahl index for sector TVL on 31 May actual shares is 2,641, which on the 2010 US Horizontal Merger Guidelines convention is "highly concentrated" (above the 2,500 threshold). The 2023 revision lowered that threshold to 1,800; the sector would have qualified for several quarters either way.

## What broke (and what nearly broke)

May was operationally calm at the protocol layer. There were no bad-debt events, no oracle incidents, no protocol pauses. The four pool protocols absorbed their May liquidations cleanly.

The dashboard itself failed in three ways during the period worth recording, because the writing standard says we do not relabel broken metrics with caveats. We fix them and say what was wrong.

NAVI's risk-parameter ingestion silently zeroed for most of May. The cron writing liquidation thresholds was being overwritten by a separate stale writer; the headline TVL was right throughout, but the risk-parameter views downstream were not. We caught it on 31 May, moved governance parameters from the per-tick PoolSnapshot table to a dedicated RateModelParams upsert path with non-zero guards, and re-seeded from the live NAVI API. The dashboard has been honest from that point.

The DefiLlama backfill ran 15 days behind. It was a manual script. It stopped at 28 May and was not run again until 12 June. The TVL chart's right edge was stale for two weeks. We promoted the backfill to a daily cron at 02:00 UTC, added a self-heal catch-up at 03:00 UTC that scans for gaps in the last 14 days, and exposed a public `/api/data-health` endpoint that an external monitor can alert on. Stale data is no longer a quiet failure mode.

An earlier draft of this report used a stale DefillamaTvl May 31 value (because the backfill had not landed when the draft was written) and headlined a +17.2% growth figure that no longer survives against fresh data. The correct number is the −1.8% the sector actually printed. This version replaces that draft. The lesson is that publication should run against a sourced query at write time, not against numbers carried in memory from an earlier session.

## What this leaves on the table

The piece I cannot write yet is per-wallet risk. NAVI exposes wallet positions through its open API. Suilend, Scallop and AlphaLend each expose positions through their own SDKs in different shapes. Bucket is CDPs. Indexing all five into a single position table is real work, and until it exists there is no honest answer to "how concentrated are borrowers?", "what fraction of TVL would liquidate in a 20% SUI drop from here?", or "is there a whale on Suilend with a thin buffer?". The dashboard removed those panels rather than ship a market-aggregate proxy that read as risk and was not.

The same indexing unlocks wallet-level overlap: how many addresses borrow on more than one Sui lending venue and at what concentration. The 12 liquidator addresses operating on multiple protocols is suggestive that the same operators bridge the venues; the borrower side may look similar.

## What I'll be watching in June

Three things, in order of importance.

I will watch whether NAVI's top liquidator concentration falls. 33% of events to one address is the kind of structure that holds until another sufficiently-capitalised bot enters and competes the bonus down. If it falls toward 20% in June without anyone shouting about it, that is a real market entering. If it stays at 33%, the bot is doing private flow and the bonus is a rent rather than a clearing price.

I will watch whether the sector's stablecoin-borrow share rises further. 46.7% in May is high for a chain-native lending market; the typical maturity path is for that share to climb as the protocol becomes a place to short stables against ecosystem upside, not against price downside. If June prints 50%-plus, the sector is becoming a leverage venue. If it falls back toward 35%, the May reading was a drawdown artefact.

I will watch whether any protocol publishes the failover rules and weighting logic for its existing secondary oracle. NAVI's Pyth-plus-Supra, Scallop's xOracle multi-source, and Suilend's Pyth-plus-Switchboard configurations all exist on paper. None of them tells the public reader whether the secondary contributes to price formation in normal operation or only on Pyth fallback, what the staleness threshold is, or what trigger weights the secondary feed in a divergence. The oracle concentration story for Sui lending changes the moment one of those documents lands. It does not require a new feed to ship.

---

**Sources:** [DefiLlama Sui lending category](https://defillama.com/protocols/lending/sui) | [DefiLlama methodology](https://docs.llama.fi/) | [NAVI Open API](https://open-api.naviprotocol.io/api/navi/pools) | [NAVI dual-oracle architecture](https://medium.com/@navi.protocol/navi-protocols-upgraded-decentralized-oracle-enhancing-security-and-robustness-with-pyth-and-248740c55f7b) | [NAVI Isolated Markets launch](https://medium.com/@navi.protocol/navi-protocol-q1-2026-recap-c774f78fd828) | [Suilend liquidations](https://docs.suilend.fi/security/liquidations) | [Scallop xOracle and liquidations](https://docs.scallop.io/scallop-lend/liquidations) | [AlphaFi/AlphaLend docs](https://docs.alphafi.xyz/alphalend/introduction/what-is-alphalend) | [Bucket Tank and liquidations](https://docs.bucketprotocol.io/mechanisms/tank-and-liquidations) | [Pyth on Sui](https://www.pyth.network/blog/pyth-low-latency-pull-oracles-launches-on-sui) | [Datum Labs Sui Lending Terminal](https://sui-lending.vercel.app)

*Methodology and full per-asset data behind every figure in this report are queryable on the live terminal. Figures as of 31 May 2026 unless otherwise noted. TVL figures use DefiLlama as the canonical cross-protocol source; live state figures come from each protocol's own on-chain data, indexed daily. All queries that produced the numbers in this report are committed at `scripts/verify-report-claims.ts` and `scripts/verify-may31-state.ts`; they are idempotent and can be re-run to reproduce every figure.*

*Datum Labs · June 2026*
