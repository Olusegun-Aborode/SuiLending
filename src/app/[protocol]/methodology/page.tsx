'use client';

import { useParams } from 'next/navigation';
import Panel from '@/components/ui/Panel';
import PageHeader from '@/components/ui/PageHeader';

const TOC = [
  { id: 'data-sources', label: 'Data Sources' },
  { id: 'refresh-cadence', label: 'Refresh Cadence' },
  { id: 'pool-metrics', label: 'Pool Metrics' },
  { id: 'interest-rate-model', label: 'Interest Rate Model' },
  { id: 'liquidation-metrics', label: 'Liquidation Metrics' },
  { id: 'gas-efficiency', label: 'Gas Efficiency' },
  { id: 'wallet-health', label: 'Wallet Health Factor' },
  { id: 'leaderboard', label: 'Leaderboard Ranking' },
  { id: 'limitations', label: 'Known Limitations' },
];

export default function MethodologyPage() {
  const { protocol } = useParams<{ protocol: string }>();
  const upper = protocol?.toUpperCase() ?? 'NAVI';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Methodology"
        subtitle="How every metric is computed, where the data comes from, and known limits."
      />

      <Panel title="Table of Contents" badge={upper}>
        <div className="methodology">
          <p>
            This page explains how every metric on the dashboard is computed, where the data
            comes from, and what the known limitations are.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
          {TOC.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="dropdown-trigger">
              {s.label}
            </a>
          ))}
        </nav>
      </Panel>

      <Section id="data-sources" title="Data Sources" badge="INFRA">
        <KV
          rows={[
            ['NAVI Open API', 'Pool metrics, token prices, reserve configs. Endpoint: open-api.naviprotocol.io/api/navi/pools'],
            ['Sui JSON-RPC', 'On-chain event queries (suix_queryEvents) and transaction details (sui_getTransactionBlock) for liquidation indexing and gas costs'],
            ['NAVI SDK', 'On-chain devInspect calls to read per-wallet deposit/borrow positions and compute health factors'],
            ['DefiLlama API', 'Historical protocol-level TVL snapshots (api.llama.fi/protocol/navi-lending)'],
          ]}
        />
      </Section>

      <Section id="refresh-cadence" title="Refresh Cadence" badge="CRON">
        <KV
          rows={[
            ['Pool Snapshots', 'Daily at 00:00 UTC. Captures totalSupply, totalBorrows, APYs, utilization, and price for every pool'],
            ['Liquidation Indexing', 'Daily at 00:15 UTC. Queries new LiquidationCall events from the chain cursor, enriches with gas cost'],
            ['Wallet Refresh', 'Daily at 00:30 UTC. Cycles through tracked wallets by priority (critical first), re-reads on-chain positions'],
            ['Daily Aggregation', 'Daily at 00:45 UTC. Rolls up snapshots into per-day averages (PoolDaily table)'],
            ['Collateral-Borrow Pairs', 'Daily at 01:00 UTC. Aggregates wallet positions into collateral/borrow pair counts'],
          ]}
        />
        <P>
          The dashboard runs on Vercel Hobby tier, which limits cron schedules to once per day.
          Metrics can be up to 24 hours stale between refreshes.
        </P>
      </Section>

      <Section id="pool-metrics" title="Pool Metrics" badge="MARKETS">
        <KV
          rows={[
            ['Total Supply', 'Sum of all deposits in a pool, sourced from NAVI API. Displayed in both token units and USD'],
            ['Total Borrows', 'Sum of all outstanding loans in a pool'],
            ['Available Liquidity', 'Total Supply minus Total Borrows — the amount available for new borrows or withdrawals'],
            ['TVL (Total Value Locked)', 'Total Supply minus Total Borrows, in USD. Represents net capital locked in the protocol'],
            ['Utilization', '(Total Borrows / Total Supply) as a percentage. Higher utilization = less available liquidity and typically higher borrow rates'],
            ['Supply APY', 'Annualized yield earned by depositors, sourced directly from the NAVI API. Derived from the interest rate model and current utilization'],
            ['Borrow APY', 'Annualized cost paid by borrowers. Also sourced from the NAVI API'],
            ['Price', 'Per-token USD price from the NAVI API, updated with each pool snapshot'],
          ]}
        />
      </Section>

      <Section id="interest-rate-model" title="Interest Rate Model" badge="CURVE">
        <P>
          Each pool uses a piecewise linear interest rate curve with a &ldquo;kink&rdquo; — a
          utilization threshold where the borrow rate accelerates sharply to incentivize
          repayment.
        </P>
        <KV
          rows={[
            ['Base Rate', 'The minimum borrow rate when utilization is 0%'],
            ['Multiplier', 'Linear slope applied to utilization below the kink: borrowRate = baseRate + utilization * multiplier'],
            ['Jump Multiplier', 'Steeper slope applied above the kink: borrowRate = baseRate + kink * multiplier + (utilization - kink) * jumpMultiplier'],
            ['Kink', 'The utilization threshold (e.g. 80%) where the rate curve steepens'],
            ['Reserve Factor', 'Fraction of interest income retained by the protocol treasury, not distributed to suppliers'],
          ]}
        />
        <P>
          Supply rate is derived from borrow rate: supplyRate = borrowRate * utilization * (1 -
          reserveFactor). Parameters are read from on-chain config objects via the Sui RPC.
        </P>
      </Section>

      <Section id="liquidation-metrics" title="Liquidation Metrics" badge="EVENTS">
        <P>
          Liquidation events are indexed from the Sui blockchain using{' '}
          <Code>suix_queryEvents</Code> with a MoveEventType filter matching NAVI&apos;s
          LiquidationCall event. Each event contains the liquidator, borrower, collateral asset,
          debt asset, amounts, prices, and treasury fee.
        </P>
        <KV
          rows={[
            ['Amount Scaling', "Both amounts and prices are scaled by the asset's decimal precision (e.g. SUI = 1e9, USDC = 1e6), NOT a universal 1e18"],
            ['Collateral USD', 'collateralAmount * collateralPrice (both after decimal scaling)'],
            ['Debt USD', 'debtAmount * debtPrice'],
            ['Treasury Fee', "treasuryAmount * collateralPrice — the protocol's cut from the seized collateral"],
            ['Gross Profit', "collateralUsd - debtUsd - (treasuryAmount * collateralPrice). This is the liquidator's revenue before gas"],
            ['Net Profit', 'Gross Profit minus total gas spent in USD'],
            ['Avg Profit', 'Gross Profit / number of liquidation events'],
          ]}
        />
      </Section>

      <Section id="gas-efficiency" title="Gas Efficiency" badge="GAS">
        <P>
          Gas cost is fetched per transaction using <Code>sui_getTransactionBlock</Code> with{' '}
          <Code>showEffects: true</Code>. The effects contain a <Code>gasCostSummary</Code>
          object.
        </P>
        <KV
          rows={[
            ['Gas Used (MIST)', 'computationCost + storageCost - storageRebate. MIST is the smallest unit on Sui (1 SUI = 1,000,000,000 MIST)'],
            ['Gas USD', 'Gas in MIST converted to USD using the SUI price at the time of the event. Price is looked up from PoolSnapshot via binary search on timestamp, with a fallback to the current SUI price'],
            ['Gas/Profit Ratio', 'totalGasUsd / grossProfit. Lower = more capital-efficient liquidations'],
            ['Coverage %', "Percentage of a liquidator's events that have gas data indexed. Events before the gas column was added require backfilling"],
          ]}
        />
      </Section>

      <Section id="wallet-health" title="Wallet Health Factor" badge="WALLETS">
        <P>
          Health factors are computed on-chain via the NAVI SDK&apos;s <Code>devInspect</Code>{' '}
          mechanism — a read-only transaction simulation that returns each wallet&apos;s
          deposit and borrow positions without modifying state.
        </P>
        <KV
          rows={[
            ['Health Factor', 'Sum of (deposit * price * LTV) across all collateral assets, divided by sum of (borrow * price) across all debt assets'],
            ['Critical (< 1.1)', 'Very close to liquidation. These wallets are refreshed first by the cron'],
            ['Warning (< 1.3)', 'Approaching danger zone. Second priority for refresh'],
            ['Normal (< 2.0)', 'Healthy but worth monitoring'],
            ['Safe (>= 2.0)', 'Well-collateralized. Lowest refresh priority'],
          ]}
        />
      </Section>

      <Section id="leaderboard" title="Leaderboard Ranking" badge="RANK">
        <KV
          rows={[
            ['Ranking Metric', 'Liquidators are ranked by gross profit descending: SUM(collateralUsd - debtUsd - treasuryAmount * collateralPrice)'],
            ['Aggregation', 'All metrics are computed via SQL GROUP BY liquidator across all LiquidationEvent rows for the protocol'],
            ['Net Profit', 'Gross profit minus total gas USD. Displayed alongside gross profit to show capital efficiency'],
            ['Profile Drilldown', 'Each row links to a per-liquidator profile showing daily activity, asset preferences, top borrowers targeted, and full event history'],
          ]}
        />
      </Section>

      <Section id="limitations" title="Known Limitations" badge="NOTES">
        <KV
          rows={[
            ['Gas Coverage', 'The gasUsedMist and gasUsd columns were added after initial indexing. A backfill script populates older rows, but coverage may be below 100%'],
            ['Funding Source', 'Not yet implemented. Tracing inbound transfers to liquidator addresses requires a dedicated transfer indexer'],
            ['Cross-Protocol', 'Only NAVI is indexed. Scallop, Suilend, and other Sui lending protocols require separate event parsers'],
            ['Price Accuracy', 'USD values use the NAVI API price at snapshot time. Rapid price movements between snapshots can cause small discrepancies'],
            ['Wallet Discovery', 'Only wallets that have emitted deposit or borrow events are tracked. Wallets that interact solely through aggregators may be missed'],
          ]}
        />
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  badge,
  children,
}: {
  id: string;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-20">
      <Panel title={title} badge={badge}>
        <div className="methodology">{children}</div>
      </Panel>
    </div>
  );
}

function KV({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
      {rows.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: 'grid',
            gridTemplateColumns: '180px 1fr',
            gap: 16,
            fontSize: 12,
          }}
        >
          <span style={{ color: 'var(--orange)', fontWeight: 600 }}>{k}</span>
          <span style={{ color: 'var(--fg)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        padding: '1px 6px',
        borderRadius: 3,
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        background: 'var(--bg-2)',
        color: 'var(--orange)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </code>
  );
}
