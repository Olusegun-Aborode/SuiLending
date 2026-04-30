'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Panel from '@/components/ui/Panel';
import Metric from '@/components/ui/Metric';
import PageHeader from '@/components/ui/PageHeader';
import Loading from '@/components/ui/Loading';
import ErrorMsg from '@/components/ui/ErrorMsg';
import FilterBar from '@/components/FilterBar';
import WalletsTable, {
  type WalletRow,
  type WalletSortField,
  type SortDir,
} from '@/components/tables/WalletsTable';
import { formatUsd } from '@/lib/utils';

function buildFilterFields(symbols: string[]) {
  return [
    { key: 'search', label: 'Wallet Address', type: 'text' as const, placeholder: '0x...' },
    { key: 'collateral', label: 'Collateral Asset', type: 'select' as const, options: symbols },
    { key: 'borrow', label: 'Borrow Asset', type: 'select' as const, options: symbols },
    { key: 'minHf', label: 'Min HF', type: 'text' as const, placeholder: '0' },
  ];
}

interface RiskCounts {
  danger: number;
  warning: number;
  safe: number;
  total: number;
}

interface Totals {
  supplyUsd: number;
  borrowUsd: number;
}

interface WalletsResponse {
  wallets: WalletRow[];
  total: number;
  riskCounts?: RiskCounts;
  totals?: Totals;
}

// Sensible initial sort direction per column. HF ascending surfaces the
// riskiest wallets first; $ columns descending show the biggest first.
const DEFAULT_DIR: Record<WalletSortField, SortDir> = {
  healthFactor: 'asc',
  collateralUsd: 'desc',
  borrowUsd: 'desc',
};

export default function WalletsPage() {
  const { protocol } = useParams<{ protocol: string }>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<WalletSortField>('healthFactor');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const limit = 25;

  const symbolsQuery = useQuery<{ symbols: string[] }>({
    queryKey: ['poolSymbols', protocol],
    queryFn: () => fetch(`/api/${protocol}/pools`).then((r) => r.json()),
  });

  const walletsQuery = useQuery<WalletsResponse>({
    queryKey: ['wallets', protocol, page, filters, sortBy, sortDir],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sortBy,
        sortDir,
      });
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      return fetch(`/api/${protocol}/wallets?${params}`).then((r) => r.json());
    },
  });

  function handleFilterChange(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function handleSortChange(field: WalletSortField) {
    if (field === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(DEFAULT_DIR[field]);
    }
    setPage(1);
  }

  const symbols = symbolsQuery.data?.symbols ?? [];
  const riskCounts = walletsQuery.data?.riskCounts;
  const totals = walletsQuery.data?.totals;
  const totalWallets = walletsQuery.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Wallet Explorer"
        subtitle="Live health-factor watchlist across tracked borrowers."
      />

      {/* Summary strip — reflects the current filter set, just like the
          table below it. Empty / loading state renders em-dashes to keep
          row heights stable. */}
      <Panel title="Wallet Summary" flush>
        <div className="grid grid-3">
          <Metric
            label="Wallets"
            value={totalWallets.toLocaleString()}
            tooltip="Count of tracked borrowers matching the current filters."
          />
          <Metric
            label="Total Supplied"
            value={totals ? formatUsd(totals.supplyUsd, true) : '—'}
            tooltip="Sum of collateral USD across all matching wallets."
          />
          <Metric
            label="Total Borrowed"
            value={totals ? formatUsd(totals.borrowUsd, true) : '—'}
            tooltip="Sum of debt USD across all matching wallets."
          />
        </div>
      </Panel>

      <Panel title="Filters" badge={`${symbols.length} ASSETS`} flush>
        <div style={{ padding: 'var(--panel-pad)' }}>
          <FilterBar
            filters={filters}
            onChange={handleFilterChange}
            fields={buildFilterFields(symbols)}
          />
        </div>
      </Panel>

      <Panel title="Borrowers" badge={<RiskBadge counts={riskCounts} />} flush>
        {walletsQuery.isPending ? (
          <Loading message="Loading wallets" />
        ) : walletsQuery.isError ? (
          <ErrorMsg message="Failed to load wallets." onRetry={() => walletsQuery.refetch()} />
        ) : (
          <WalletsTable
            data={walletsQuery.data.wallets ?? []}
            total={walletsQuery.data.total ?? 0}
            page={page}
            limit={limit}
            onPageChange={setPage}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={handleSortChange}
          />
        )}
      </Panel>
    </div>
  );
}

/**
 * Risk summary rendered in the Borrowers panel header. Danger (HF < 1.2)
 * and warning (HF 1.2–1.5) counts in their band colors, then the total.
 */
function RiskBadge({ counts }: { counts?: RiskCounts }) {
  if (!counts) return <span>LOADING…</span>;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'var(--font-mono)',
      }}
    >
      <span style={{ color: '#F97316', fontWeight: 600 }}>{counts.danger} CRITICAL</span>
      <span style={{ color: 'var(--fg-dim)' }}>·</span>
      <span style={{ color: '#EAB308', fontWeight: 600 }}>{counts.warning} WARNING</span>
      <span style={{ color: 'var(--fg-dim)' }}>·</span>
      <span style={{ color: 'var(--fg-muted)' }}>{counts.total.toLocaleString()} TOTAL</span>
    </span>
  );
}
