'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn, formatUsd, formatNumber, formatPercent, getAssetColor } from '@/lib/utils';
import { ChevronUp, ChevronDown } from 'lucide-react';
import InfoTooltip from '@/components/InfoTooltip';

export interface MarketRow {
  symbol: string;
  poolId?: number;
  totalSupply: number;
  totalSupplyUsd: number;
  totalBorrows: number;
  totalBorrowsUsd: number;
  availableLiquidity: number;
  availableLiquidityUsd: number;
  supplyApy: number;
  borrowApy: number;
  utilization: number;
}

type SortKey = keyof MarketRow;

interface MarketsTableProps {
  data: MarketRow[];
  protocolSlug?: string;
}

export default function MarketsTable({ data, protocolSlug }: MarketsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('totalSupplyUsd');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = [...data].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortAsc ? aVal - bVal : bVal - aVal;
    }
    return String(aVal).localeCompare(String(bVal)) * (sortAsc ? 1 : -1);
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey !== col ? null : sortAsc ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />;

  const columns: Array<{ key: SortKey; label: string; align?: 'right'; tooltip?: string }> = [
    { key: 'symbol', label: 'Market' },
    { key: 'totalSupplyUsd', label: 'Total Supply', align: 'right' },
    { key: 'totalBorrowsUsd', label: 'Total Borrows', align: 'right' },
    { key: 'availableLiquidityUsd', label: 'Liquidity', align: 'right' },
    { key: 'supplyApy', label: 'Supply APY', align: 'right', tooltip: 'Annualized yield earned by suppliers, from borrower interest' },
    { key: 'borrowApy', label: 'Borrow APY', align: 'right', tooltip: 'Annualized cost paid by borrowers' },
    { key: 'utilization', label: 'Utilization', align: 'right', tooltip: 'Borrowed / Supplied — higher means less available liquidity' },
  ];

  return (
    <div className="overflow-x-auto">
      {/* Explicit column widths + fixed layout so the browser doesn't dump
          slack width into an arbitrary column. Columns are listed in the
          same order as `columns` above. */}
      <table className="data-table" style={{ tableLayout: 'fixed', minWidth: 960 }}>
        <colgroup>
          <col style={{ width: '10%' }} /> {/* Market */}
          <col style={{ width: '16%' }} /> {/* Total Supply */}
          <col style={{ width: '16%' }} /> {/* Total Borrows */}
          <col style={{ width: '16%' }} /> {/* Liquidity */}
          <col style={{ width: '12%' }} /> {/* Supply APY */}
          <col style={{ width: '12%' }} /> {/* Borrow APY */}
          <col style={{ width: '18%' }} /> {/* Utilization (bar + %) */}
        </colgroup>
        <thead>
          <tr>
            {columns.map((col) => {
              const isRight = col.align === 'right';
              // Right-aligned numeric columns: render the sort arrow + tooltip
              // BEFORE the label so the label's right edge stays flush with the
              // numbers below it regardless of which column is active.
              return (
                <th
                  key={col.key}
                  className={cn(
                    'cursor-pointer transition-colors hover:text-white',
                    isRight && 'text-right',
                  )}
                  onClick={() => handleSort(col.key)}
                >
                  {isRight ? (
                    <>
                      <SortIcon col={col.key} />
                      {col.tooltip && <InfoTooltip text={col.tooltip} />} {col.label}
                    </>
                  ) : (
                    <>
                      {col.label} {col.tooltip && <InfoTooltip text={col.tooltip} />}{' '}
                      <SortIcon col={col.key} />
                    </>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                No pool data available — connect RPC to fetch live data
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={row.poolId ?? row.symbol}>
                <td>
                  <Link
                    href={protocolSlug ? `/${protocolSlug}/markets/${row.symbol}` : `/markets/${row.symbol}`}
                    className="flex items-center gap-2 hover:text-[var(--accent-orange)]"
                    style={{ color: 'var(--foreground)' }}
                  >
                    <span className="token-dot" style={{ backgroundColor: getAssetColor(row.symbol) }} />
                    <span className="font-medium">{row.symbol}</span>
                  </Link>
                </td>
                <td className="text-right">
                  <div>{formatUsd(row.totalSupplyUsd, true)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {formatNumber(row.totalSupply)} {row.symbol}
                  </div>
                </td>
                <td className="text-right">
                  <div>{formatUsd(row.totalBorrowsUsd, true)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {formatNumber(row.totalBorrows)} {row.symbol}
                  </div>
                </td>
                <td className="text-right">
                  <div>{formatUsd(row.availableLiquidityUsd, true)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {formatNumber(row.availableLiquidity)} {row.symbol}
                  </div>
                </td>
                <td className="text-right" style={{ color: 'var(--accent-green)' }}>
                  {formatPercent(row.supplyApy)}
                </td>
                <td className="text-right" style={{ color: 'var(--accent-red)' }}>
                  {formatPercent(row.borrowApy)}
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="tui-progress w-16">
                      <div
                        className="tui-progress-fill"
                        style={{
                          width: `${Math.min(row.utilization, 100)}%`,
                          background: 'var(--accent-orange)',
                        }}
                      />
                    </div>
                    <span>{formatPercent(row.utilization)}</span>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
