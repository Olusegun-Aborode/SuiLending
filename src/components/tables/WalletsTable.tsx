'use client';

import { ChevronDown, ChevronUp, ArrowUpDown, ExternalLink } from 'lucide-react';
import { formatUsd, truncateAddress, formatNumber } from '@/lib/utils';
import { healthFactorColor, healthFactorLabel } from '@/lib/constants';

export interface WalletRow {
  address: string;
  collateralUsd: number;
  borrowUsd: number;
  healthFactor: number;
  collateralAssets: string;
  borrowAssets: string;
}

export type WalletSortField = 'healthFactor' | 'collateralUsd' | 'borrowUsd';
export type SortDir = 'asc' | 'desc';

interface WalletsTableProps {
  data: WalletRow[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  sortBy: WalletSortField;
  sortDir: SortDir;
  onSortChange: (field: WalletSortField) => void;
}

function parseAssets(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const symbols = parsed
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && 'symbol' in entry)
          return String((entry as { symbol: unknown }).symbol);
        return null;
      })
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    return Array.from(new Set(symbols));
  } catch {
    return [];
  }
}

/**
 * Positions cell — total count of distinct asset positions (collateral +
 * debt). Single number so rows stay uniform height; native title attribute
 * carries the breakdown so hovering always works regardless of the
 * table's overflow-x wrapper.
 */
function PositionsCell({
  collateralJson,
  borrowJson,
}: {
  collateralJson: string;
  borrowJson: string;
}) {
  const c = parseAssets(collateralJson);
  const d = parseAssets(borrowJson);
  const total = c.length + d.length;
  const tooltip =
    `${c.length} collateral${c.length === 1 ? '' : 's'}${c.length ? ' (' + c.join(', ') + ')' : ''}\n` +
    `${d.length} debt${d.length === 1 ? '' : 's'}${d.length ? ' (' + d.join(', ') + ')' : ''}`;
  return (
    <span
      title={tooltip}
      style={{ fontVariantNumeric: 'tabular-nums', cursor: 'help' }}
    >
      {total}
    </span>
  );
}

/**
 * Header with built-in sort affordance. Active column shows its direction;
 * inactive columns show a dim up/down glyph so the sortability is obvious.
 *
 * Header `tooltip` uses the browser's native `title` attribute — styled
 * CSS popups get clipped by the <div overflow-x-auto> wrapper around the
 * table, and a header isn't the place to fight that.
 */
function SortableHeader({
  field,
  label,
  tooltip,
  align,
  sortBy,
  sortDir,
  onSortChange,
}: {
  field: WalletSortField;
  label: string;
  tooltip?: string;
  align?: 'left' | 'right';
  sortBy: WalletSortField;
  sortDir: SortDir;
  onSortChange: (f: WalletSortField) => void;
}) {
  const active = sortBy === field;
  const icon = active ? (
    sortDir === 'asc' ? (
      <ChevronUp className="inline h-3 w-3" />
    ) : (
      <ChevronDown className="inline h-3 w-3" />
    )
  ) : (
    <ArrowUpDown className="inline h-3 w-3" style={{ opacity: 0.35 }} />
  );
  return (
    <th
      className={align === 'right' ? 'text-right' : ''}
      onClick={() => onSortChange(field)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      title={tooltip}
    >
      {align === 'right' ? (
        <>
          {icon} {label}
        </>
      ) : (
        <>
          {label} {icon}
        </>
      )}
    </th>
  );
}

export default function WalletsTable({
  data,
  total,
  page,
  limit,
  onPageChange,
  sortBy,
  sortDir,
  onSortChange,
}: WalletsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="overflow-x-auto">
        {/* One row = one line. Every cell content is single-line so row
            heights stay uniform regardless of how many assets a wallet holds.
            6 columns sum to 100%; width:100% fills the panel. */}
        <table
          className="data-table"
          style={{ tableLayout: 'fixed', width: '100%', minWidth: 960 }}
        >
          <colgroup>
            <col style={{ width: '16%' }} /> {/* Wallet */}
            <col style={{ width: '17%' }} /> {/* Collateral */}
            <col style={{ width: '17%' }} /> {/* Debt */}
            <col style={{ width: '20%' }} /> {/* Health Factor */}
            <col style={{ width: '16%' }} /> {/* Positions */}
            <col style={{ width: '14%' }} /> {/* LTV */}
          </colgroup>
          <thead>
            <tr>
              <th>Wallet</th>
              <SortableHeader
                field="collateralUsd"
                label="Collateral"
                align="right"
                sortBy={sortBy}
                sortDir={sortDir}
                onSortChange={onSortChange}
              />
              <SortableHeader
                field="borrowUsd"
                label="Debt"
                align="right"
                sortBy={sortBy}
                sortDir={sortDir}
                onSortChange={onSortChange}
              />
              <SortableHeader
                field="healthFactor"
                label="Health Factor"
                tooltip="Weighted collateral / total borrows — below 1.0 = liquidatable"
                sortBy={sortBy}
                sortDir={sortDir}
                onSortChange={onSortChange}
              />
              <th
                className="text-right"
                title="Total asset positions — collateral + debt. Hover a row's count for the breakdown."
              >
                Positions
              </th>
              <th
                className="text-right"
                title="Loan-to-Value — raw borrows / collateral. A different view on leverage than HF (which weights by per-asset LTV caps)."
              >
                LTV
              </th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center"
                  style={{ color: 'var(--fg-muted)' }}
                >
                  No wallet positions indexed yet — run the wallet indexer cron
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const hfColor = healthFactorColor(row.healthFactor);
                const hfLabel = healthFactorLabel(row.healthFactor);
                const ltv =
                  row.collateralUsd > 0 ? (row.borrowUsd / row.collateralUsd) * 100 : null;
                // 2px left border in the HF band color turns the sortable
                // table into a heatmap — critical rows stay visible as you
                // scroll.
                const tint: React.CSSProperties = { borderLeft: `2px solid ${hfColor}` };
                return (
                  <tr key={row.address}>
                    <td className="text-xs" style={tint}>
                      <a
                        href={`https://suiscan.xyz/mainnet/account/${row.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: 'var(--fg)',
                        }}
                        title="Open in Suiscan"
                      >
                        {truncateAddress(row.address)}
                        <ExternalLink
                          size={10}
                          style={{ color: 'var(--fg-dim)' }}
                          aria-hidden
                        />
                      </a>
                    </td>
                    <td className="text-right">{formatUsd(row.collateralUsd, true)}</td>
                    <td className="text-right">{formatUsd(row.borrowUsd, true)}</td>
                    <td>
                      <span
                        className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] uppercase tracking-[0.05em]"
                        style={{
                          color: hfColor,
                          background: `${hfColor}15`,
                          border: `1px solid ${hfColor}40`,
                        }}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: hfColor }}
                        />
                        {row.healthFactor >= 100 ? '99+' : formatNumber(row.healthFactor, 2)}
                        <span className="opacity-70">{hfLabel}</span>
                      </span>
                    </td>
                    <td className="text-right">
                      <PositionsCell
                        collateralJson={row.collateralAssets}
                        borrowJson={row.borrowAssets}
                      />
                    </td>
                    <td className="text-right">
                      <LtvCell ltv={ltv} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="status-bar">
          <span className="status-bar-item">
            <span style={{ color: 'var(--orange)' }}>&gt;</span>
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="time-btn disabled:opacity-30"
              type="button"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="time-btn disabled:opacity-30"
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * LTV = borrows / collateral (raw, unweighted). Different from HF, which
 * applies per-asset LTV caps. Shown as percent + thin bar.
 *
 * Anything above 100% means the wallet is underwater (debt exceeds raw
 * collateral value) — usually dust collateral from a stale index, or a
 * position that escaped liquidation during a price crash. The exact
 * percentage past 100 isn't meaningful, so we clamp the label to "100%+"
 * and keep the raw number in the native title for debugging.
 */
function LtvCell({ ltv }: { ltv: number | null }) {
  if (ltv === null) {
    return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
  }
  const over = ltv > 100;
  const barColor = over
    ? 'var(--red)'
    : ltv < 50
    ? 'var(--green)'
    : ltv < 75
    ? 'var(--yellow)'
    : 'var(--red)';
  const pct = Math.min(ltv, 100);
  const label = over ? '100%+' : `${ltv.toFixed(1)}%`;
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 3,
        minWidth: 70,
      }}
      title={
        over
          ? `Underwater — raw ratio ${ltv.toFixed(1)}% (debt exceeds collateral)`
          : undefined
      }
    >
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          color: over ? 'var(--red)' : undefined,
          fontWeight: over ? 600 : undefined,
        }}
      >
        {label}
      </span>
      <div
        style={{
          width: 60,
          height: 3,
          background: 'var(--bg-2)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
