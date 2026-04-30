'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Panel from '@/components/ui/Panel';
import Metric from '@/components/ui/Metric';
import ChartPanel from '@/components/ui/ChartPanel';
import PageHeader from '@/components/ui/PageHeader';
import Loading from '@/components/ui/Loading';
import ErrorMsg from '@/components/ui/ErrorMsg';
import AssetFilter from '@/components/ui/AssetFilter';
import StackedAreaChart from '@/components/charts/StackedAreaChart';
import { formatUsd } from '@/lib/utils';

interface PoolData {
  symbol: string;
  totalSupplyUsd: number;
  totalBorrowsUsd: number;
}
interface PoolsResponse {
  pools: PoolData[];
  totals: { totalSupplyUsd: number; totalBorrowsUsd: number; tvl: number };
  protocolName?: string;
  symbols?: string[];
}
interface HistoryRow {
  symbol: string;
  date: string;
  closeTotalSupplyUsd: number;
  closeTotalBorrowsUsd: number;
  closeLiquidityUsd: number;
}

export default function OverviewPage() {
  const { protocol } = useParams<{ protocol: string }>();
  const [days, setDays] = useState(30);
  // `undefined` = "all assets"; keeps the filter component from needing the
  // symbol list in its empty state. Shared across the three by-asset
  // charts below — toggling an asset affects Supply / Borrows / TVL
  // identically.
  const [activeSymbols, setActiveSymbols] = useState<string[] | undefined>(undefined);

  const poolsQuery = useQuery<PoolsResponse>({
    queryKey: ['pools', protocol],
    queryFn: () => fetch(`/api/${protocol}/pools`).then((r) => r.json()),
  });

  const historyQuery = useQuery<{ history: HistoryRow[] }>({
    queryKey: ['poolsHistory', protocol, days],
    queryFn: () =>
      fetch(`/api/${protocol}/pools/history?days=${days}`).then((r) => r.json()),
  });

  if (poolsQuery.isPending) return <Loading message="Loading pools" />;
  if (poolsQuery.isError)
    return <ErrorMsg message="Failed to load pools." onRetry={() => poolsQuery.refetch()} />;

  const pools = poolsQuery.data;
  const history = historyQuery.data?.history ?? [];
  const symbols = pools.symbols ?? pools.pools.map((p) => p.symbol);
  const t = pools.totals;
  const utilizationPct = t.totalSupplyUsd > 0 ? (t.totalBorrowsUsd / t.totalSupplyUsd) * 100 : 0;

  function buildChartData(valueKey: string) {
    const dateMap = new Map<string, Record<string, unknown>>();
    for (const row of history) {
      const dateStr = new Date(row.date).toISOString().split('T')[0];
      if (!dateMap.has(dateStr)) dateMap.set(dateStr, { date: dateStr });
      const entry = dateMap.get(dateStr)!;
      if (valueKey === 'supply') entry[`${row.symbol}_supply`] = row.closeTotalSupplyUsd;
      if (valueKey === 'borrows') entry[`${row.symbol}_borrows`] = row.closeTotalBorrowsUsd;
      if (valueKey === 'tvl') entry[`${row.symbol}_tvl`] = row.closeLiquidityUsd;
    }
    return Array.from(dateMap.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Protocol Overview"
        subtitle={
          <>
            NAVI · Sui · <span className="ok">LIVE</span>
          </>
        }
      />

      <Panel title="Key Metrics" badge={`${symbols.length} POOLS`} flush>
        <div className="grid grid-4">
          <Metric
            label="Total Supplied"
            value={formatUsd(t.totalSupplyUsd, true)}
            tooltip="Sum of all deposited assets across pools, in USD"
          />
          <Metric
            label="Total Borrowed"
            value={formatUsd(t.totalBorrowsUsd, true)}
            tooltip="Sum of all outstanding borrows across pools, in USD"
          />
          <Metric
            label="TVL"
            value={formatUsd(t.tvl, true)}
            tooltip="Total Value Locked = Total Supplied − Total Borrowed"
          />
          <Metric
            label="Utilization"
            value={`${utilizationPct.toFixed(2)}%`}
            tooltip="Total Borrowed / Total Supplied as a percentage"
          />
        </div>
      </Panel>

      {/* Supply and Borrow share the same 7/30/90 toggle + asset filter so
          they read as a pair. On narrow screens they collapse to a single
          column via the `.grid-2` media query in globals.css. */}
      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <ChartPanel
          title="Total Supply by Asset"
          badge={`${days}D`}
          timeRanges={[7, 30, 90]}
          selectedRange={days}
          onRangeChange={setDays}
          actions={
            <AssetFilter
              symbols={symbols}
              selected={activeSymbols}
              onChange={setActiveSymbols}
            />
          }
        >
          <StackedAreaChart
            data={buildChartData('supply')}
            symbols={symbols}
            valueKey="supply"
            activeSymbols={activeSymbols}
          />
        </ChartPanel>

        <ChartPanel
          title="Total Borrows by Asset"
          badge={`${days}D`}
          timeRanges={[7, 30, 90]}
          selectedRange={days}
          onRangeChange={setDays}
          actions={
            <AssetFilter
              symbols={symbols}
              selected={activeSymbols}
              onChange={setActiveSymbols}
            />
          }
        >
          <StackedAreaChart
            data={buildChartData('borrows')}
            symbols={symbols}
            valueKey="borrows"
            activeSymbols={activeSymbols}
          />
        </ChartPanel>
      </div>

      <ChartPanel
        title="TVL by Asset"
        badge={`${days}D`}
        timeRanges={[7, 30, 90]}
        selectedRange={days}
        onRangeChange={setDays}
        actions={
          <AssetFilter
            symbols={symbols}
            selected={activeSymbols}
            onChange={setActiveSymbols}
          />
        }
      >
        <StackedAreaChart
          data={buildChartData('tvl')}
          symbols={symbols}
          valueKey="tvl"
          activeSymbols={activeSymbols}
        />
      </ChartPanel>
    </div>
  );
}
