'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import ChartPanel from '@/components/ui/ChartPanel';
import PageHeader from '@/components/ui/PageHeader';
import Loading from '@/components/ui/Loading';
import ErrorMsg from '@/components/ui/ErrorMsg';
import FilterBar from '@/components/FilterBar';
import LiquidationsTable, { type LiquidationRow } from '@/components/tables/LiquidationsTable';
import DonutChart from '@/components/charts/DonutChart';
import StackedDailyChart from '@/components/charts/StackedDailyChart';

function buildFilterFields(symbols: string[]) {
  return [
    { key: 'borrower', label: 'Borrower', type: 'text' as const, placeholder: '0x...' },
    { key: 'liquidator', label: 'Liquidator', type: 'text' as const, placeholder: '0x...' },
    { key: 'collateral', label: 'Collateral Asset', type: 'select' as const, options: symbols },
    { key: 'debt', label: 'Debt Asset', type: 'select' as const, options: symbols },
    { key: 'from', label: 'From Date', type: 'date' as const },
    { key: 'to', label: 'To Date', type: 'date' as const },
  ];
}

interface LiquidationStats {
  collateralDistribution: Array<{ asset: string; totalUsd: number }>;
  dailySeized: Array<{ date: string; totalUsd: number }>;
  dailySeizedByAsset: Array<Record<string, string | number>>;
  dailySeizedAssets: string[];
}
interface EventsResponse {
  events: LiquidationRow[];
  total: number;
}

export default function LiquidationPage() {
  const { protocol } = useParams<{ protocol: string }>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const limit = 25;

  const symbolsQuery = useQuery<{ symbols: string[] }>({
    queryKey: ['poolSymbols', protocol],
    queryFn: () => fetch(`/api/${protocol}/pools`).then((r) => r.json()),
  });

  const eventsQuery = useQuery<EventsResponse>({
    queryKey: ['liquidations', protocol, page, filters],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      return fetch(`/api/${protocol}/liquidations?${params}`).then((r) => r.json());
    },
  });

  const statsQuery = useQuery<LiquidationStats>({
    queryKey: ['liquidationStats', protocol],
    queryFn: () => fetch(`/api/${protocol}/liquidations/stats`).then((r) => r.json()),
  });

  function handleFilterChange(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  const symbols = symbolsQuery.data?.symbols ?? [];
  const donutData = (statsQuery.data?.collateralDistribution ?? []).map((d) => ({
    name: d.asset,
    value: d.totalUsd,
  }));
  const dailyByAsset = statsQuery.data?.dailySeizedByAsset ?? [];
  const dailyAssets = statsQuery.data?.dailySeizedAssets ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Liquidation Terminal"
        subtitle="Every seized position, enriched with gas cost and net profit."
        actions={
          <Link
            href={`/${protocol}/liquidation/leaderboard`}
            className="dropdown-trigger"
            style={{
              background: 'var(--orange)',
              borderColor: 'var(--orange)',
              color: 'white',
              fontWeight: 600,
            }}
          >
            <Trophy size={12} />
            Leaderboard →
          </Link>
        }
      />

      <Panel title="Filters" badge={`${symbols.length} ASSETS`} flush>
        <div style={{ padding: 'var(--panel-pad)' }}>
          <FilterBar
            filters={filters}
            onChange={handleFilterChange}
            fields={buildFilterFields(symbols)}
          />
        </div>
      </Panel>

      {/* Donut + daily chart as a pair, same height, equal columns. The
          daily bars are stacked by collateral asset so operators can see
          not just *how much* was seized on a given day, but *what*. */}
      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <ChartPanel title="Collateral Seized Distribution" badge="30D" height={320}>
          <DonutChart data={donutData} />
        </ChartPanel>
        <ChartPanel title="Daily Collateral Seized" badge="30D" height={320}>
          <StackedDailyChart data={dailyByAsset} assets={dailyAssets} />
        </ChartPanel>
      </div>

      <Panel
        title="Liquidation Events"
        badge={eventsQuery.data ? `${eventsQuery.data.total} TOTAL` : undefined}
        flush
      >
        {eventsQuery.isPending ? (
          <Loading message="Loading events" />
        ) : eventsQuery.isError ? (
          <ErrorMsg message="Failed to load events." onRetry={() => eventsQuery.refetch()} />
        ) : (
          <LiquidationsTable
            data={eventsQuery.data.events ?? []}
            total={eventsQuery.data.total ?? 0}
            page={page}
            limit={limit}
            onPageChange={setPage}
          />
        )}
      </Panel>
    </div>
  );
}
