'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Panel from '@/components/ui/Panel';
import ChartPanel from '@/components/ui/ChartPanel';
import PageHeader from '@/components/ui/PageHeader';
import Metric from '@/components/ui/Metric';
import Loading from '@/components/ui/Loading';
import ErrorMsg from '@/components/ui/ErrorMsg';
import SimpleBarChart from '@/components/charts/SimpleBarChart';
import LiquidationsTable, { type LiquidationRow } from '@/components/tables/LiquidationsTable';
import {
  formatUsd,
  formatNumber,
  formatPercent,
  formatDateFull,
  truncateAddress,
} from '@/lib/utils';

interface Summary {
  count: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  treasuryUsd: number;
  grossProfit: number;
  totalGasUsd: number;
  netProfit: number;
  avgProfit: number;
  firstSeen: string;
  lastSeen: string;
}
interface GasEfficiency {
  totalGasUsd: number;
  avgGasUsdPerLiquidation: number;
  gasToProfitRatio: number | null;
  coverage: number;
}
interface DailyRow {
  date: string;
  count: number;
  grossProfit: number;
  gasUsd: number;
}
interface AssetRow {
  asset: string;
  count: number;
  totalUsd: number;
}
interface BorrowerRow {
  borrower: string;
  count: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
}
interface ProfileResponse {
  summary: Summary;
  gasEfficiency: GasEfficiency;
  daily: DailyRow[];
  assets: { collateralSeized: AssetRow[]; debtRepaid: AssetRow[] };
  topBorrowers: BorrowerRow[];
  events: LiquidationRow[];
  total: number;
  page: number;
  limit: number;
}

export default function LiquidatorProfilePage({
  params,
}: {
  params: Promise<{ protocol: string; address: string }>;
}) {
  const { protocol, address } = use(params);
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data, isPending, isError, refetch } = useQuery<ProfileResponse>({
    queryKey: ['liquidatorProfile', protocol, address, page],
    queryFn: () =>
      fetch(
        `/api/${protocol}/liquidations/liquidator/${address}?page=${page}&limit=${limit}`
      ).then((r) => r.json()),
  });

  if (isPending) return <Loading message="Loading liquidator profile" />;
  if (isError || !data || !data.summary) {
    return <ErrorMsg message="Failed to load liquidator profile." onRetry={() => refetch()} />;
  }

  const { summary, gasEfficiency, daily, assets, topBorrowers, events, total } = data;

  const dailyChartData = daily.map((d) => ({
    date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
    value: d.grossProfit,
  }));

  function copyAddress() {
    if (typeof navigator !== 'undefined') navigator.clipboard?.writeText(address);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Liquidator · ${truncateAddress(address, 8)}`}
        subtitle={
          <>
            First seen {formatDateFull(summary.firstSeen)} · last active{' '}
            {formatDateFull(summary.lastSeen)}
          </>
        }
        actions={
          <>
            <Link href={`/${protocol}/liquidation/leaderboard`} className="dropdown-trigger">
              <ArrowLeft size={12} />
              Leaderboard
            </Link>
            <button onClick={copyAddress} className="dropdown-trigger" type="button">
              <Copy size={12} />
              Copy
            </button>
            <a
              href={`https://suiscan.xyz/mainnet/account/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="dropdown-trigger"
              style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }}
            >
              Suiscan <ExternalLink size={12} />
            </a>
          </>
        }
      />

      <Panel title="Liquidator Summary" badge="NAVI" flush>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}
        >
          <Metric label="Liquidations" value={summary.count.toLocaleString()} />
          <Metric label="Gross Profit" value={formatUsd(summary.grossProfit, true)} />
          <Metric label="Net Profit" value={formatUsd(summary.netProfit, true)} />
          <Metric label="Total Seized" value={formatUsd(summary.totalCollateralUsd, true)} />
          <Metric label="Total Repaid" value={formatUsd(summary.totalDebtUsd, true)} />
          <Metric label="Avg Profit" value={formatUsd(summary.avgProfit, true)} />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          <span>First Seen: {formatDateFull(summary.firstSeen)}</span>
          <span>Last Active: {formatDateFull(summary.lastSeen)}</span>
          <span>Treasury Paid: {formatUsd(summary.treasuryUsd, true)}</span>
          <span>Total Gas: {formatUsd(summary.totalGasUsd, true)}</span>
        </div>
      </Panel>

      <ChartPanel title="Daily Gross Profit" badge="ALL TIME">
        <SimpleBarChart data={dailyChartData} color="var(--green)" />
      </ChartPanel>

      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <Panel
          title="Collateral Seized by Asset"
          badge={`${assets.collateralSeized.length} ASSETS`}
          flush
        >
          <AssetTable rows={assets.collateralSeized} />
        </Panel>
        <Panel title="Debt Repaid by Asset" badge={`${assets.debtRepaid.length} ASSETS`} flush>
          <AssetTable rows={assets.debtRepaid} />
        </Panel>
      </div>

      <Panel title="Borrowers Targeted" badge={`TOP ${topBorrowers.length}`} flush>
        <div style={{ overflowX: 'auto' }}>
          <table className="datatable">
            <thead>
              <tr>
                <th>Borrower</th>
                <th className="num">Liquidations</th>
                <th className="num">Total Seized</th>
                <th className="num">Total Repaid</th>
              </tr>
            </thead>
            <tbody>
              {topBorrowers.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--fg-muted)' }}>
                    No borrower data
                  </td>
                </tr>
              ) : (
                topBorrowers.map((b) => (
                  <tr key={b.borrower}>
                    <td>{truncateAddress(b.borrower)}</td>
                    <td className="num">{b.count.toLocaleString()}</td>
                    <td className="num">{formatUsd(b.totalCollateralUsd, true)}</td>
                    <td className="num">{formatUsd(b.totalDebtUsd, true)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Gas Efficiency"
        badge={`${(gasEfficiency.coverage * 100).toFixed(0)}% INDEXED`}
        flush
      >
        <div className="grid grid-4">
          <Metric label="Total Gas Spent" value={formatUsd(gasEfficiency.totalGasUsd, true)} />
          <Metric
            label="Avg Gas / Liquidation"
            value={formatUsd(gasEfficiency.avgGasUsdPerLiquidation)}
          />
          <Metric
            label="Gas / Profit Ratio"
            tooltip="Total gas spent / gross profit — lower is more efficient"
            value={
              gasEfficiency.gasToProfitRatio == null
                ? '—'
                : formatPercent(gasEfficiency.gasToProfitRatio * 100)
            }
          />
          <Metric label="Net Profit" value={formatUsd(summary.netProfit, true)} />
        </div>
        {gasEfficiency.coverage < 1 && (
          <div
            style={{
              borderTop: '1px solid var(--border)',
              padding: '10px 14px',
              fontSize: 11,
              color: 'var(--fg-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {((1 - gasEfficiency.coverage) * 100).toFixed(0)}% of this liquidator&apos;s events
            are still being backfilled. Numbers will update as the gas backfill completes.
          </div>
        )}
      </Panel>

      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <Panel title="Funding Source" badge="COMING SOON">
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
            Funding-source analysis traces inbound SUI / USDC / WETH transfers to a
            liquidator&apos;s address before their first liquidation. This requires a
            dedicated transfer indexer that we have not built yet.
          </p>
        </Panel>
        <Panel title="Cross-Protocol Activity" badge="COMING SOON">
          <p style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
            We currently index NAVI only. Cross-protocol stats (Scallop, Suilend, etc.) require
            additional event indexers and are not yet wired into the dataset.
          </p>
        </Panel>
      </div>

      <Panel title="Event History" badge={`${total} EVENTS`} flush>
        <LiquidationsTable
          data={events}
          total={total}
          page={page}
          limit={limit}
          onPageChange={setPage}
        />
      </Panel>
    </div>
  );
}

function AssetTable({ rows }: { rows: AssetRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="datatable">
        <thead>
          <tr>
            <th>Asset</th>
            <th className="num">Count</th>
            <th className="num">Total USD</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--fg-muted)' }}>
                No data
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.asset}>
                <td>{r.asset}</td>
                <td className="num">{formatNumber(r.count, 0)}</td>
                <td className="num">{formatUsd(r.totalUsd, true)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
