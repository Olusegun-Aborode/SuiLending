'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatDate, formatUsd, getAssetColor } from '@/lib/utils';

interface StackedDailyChartProps {
  /**
   * Flat rows like `{ date: '2026-04-21', vSUI: 120, USDC: 45 }`. Keys
   * other than `date` are asset symbols whose values are stacked on the
   * same bar.
   */
  data: Array<Record<string, string | number>>;
  /** Assets sorted by 30d total desc (used for stacking order + top-N cut). */
  assets: string[];
}

const TOP_N = 8;
const OTHER_LABEL = 'Other';
const OTHER_COLOR = '#9CA3AF';

interface TooltipPayloadEntry {
  name?: string;
  value?: number;
  color?: string;
}

function StackedTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload
    .filter((p) => typeof p.value === 'number' && p.value > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const total = rows.reduce((s, p) => s + (p.value ?? 0), 0);
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        background: 'var(--fg)',
        color: 'var(--bg)',
        borderRadius: 4,
        padding: '8px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        minWidth: 180,
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 6 }}>{formatDate(String(label))}</div>
      {rows.map((p) => (
        <div
          key={p.name}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 12, lineHeight: 1.6 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: 1,
                background: p.color,
              }}
            />
            {p.name}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatUsd(p.value ?? 0, true)}
          </span>
        </div>
      ))}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid rgba(255,255,255,0.15)',
          fontWeight: 600,
        }}
      >
        <span>TOTAL</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatUsd(total, true)}</span>
      </div>
    </div>
  );
}

/**
 * StackedDailyChart — daily bars split by collateral asset.
 *
 * With 20+ assets the raw stack legend wraps into the plot and looks
 * terrible. Instead we render the top N assets individually, bucket the
 * rest into an "Other" series, and ship a compact single-line legend
 * below the chart (the Recharts built-in legend is disabled).
 */
export default function StackedDailyChart({ data, assets }: StackedDailyChartProps) {
  const { visibleAssets, seriesKeys, rows, anyOther } = useMemo(() => {
    const top = assets.slice(0, TOP_N);
    const topSet = new Set(top);
    const anyOther = assets.length > top.length;

    // Rebuild each row: keep top-N keys as-is, fold everything else into
    // the `Other` field. If an event's asset is outside the top list (or
    // would be numerically for that day) it lands in Other.
    const rows = data.map((row) => {
      const out: Record<string, string | number> = { date: String(row.date) };
      let otherSum = 0;
      for (const key of Object.keys(row)) {
        if (key === 'date') continue;
        const val = Number(row[key]);
        if (!Number.isFinite(val) || val === 0) continue;
        if (topSet.has(key)) out[key] = val;
        else otherSum += val;
      }
      if (otherSum > 0) out[OTHER_LABEL] = otherSum;
      return out;
    });

    const seriesKeys = anyOther ? [...top, OTHER_LABEL] : top;
    return { visibleAssets: top, seriesKeys, rows, anyOther };
  }, [data, assets]);

  if (rows.length === 0 || seriesKeys.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-xs"
        style={{ color: 'var(--fg-muted)' }}
      >
        No data available
      </div>
    );
  }

  const colorFor = (key: string) => (key === OTHER_LABEL ? OTHER_COLOR : getAssetColor(key));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Plot area — reserve the rest of the space for the legend. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => formatDate(String(v))}
              tick={{ fill: 'var(--fg-muted)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => formatUsd(Number(v), true)}
              tick={{ fill: 'var(--fg-muted)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              width={60}
            />
            <Tooltip content={<StackedTooltip />} cursor={{ fill: 'var(--hover)' }} />
            {seriesKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="s"
                fill={colorFor(key)}
                radius={i === seriesKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Custom legend — single line, horizontally scrollable if it ever
          overflows (shouldn't with top-8 + Other). Kept *below* the plot
          so it never steals vertical space from the bars. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 14px',
          padding: '8px 4px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--fg-muted)',
          borderTop: '1px solid var(--border)',
          marginTop: 6,
        }}
      >
        {visibleAssets.map((a) => (
          <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                background: colorFor(a),
              }}
            />
            <span style={{ color: 'var(--fg)' }}>{a}</span>
          </span>
        ))}
        {anyOther && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                background: OTHER_COLOR,
              }}
            />
            <span style={{ color: 'var(--fg)' }}>
              {OTHER_LABEL}{' '}
              <span style={{ color: 'var(--fg-dim)' }}>
                ({assets.length - visibleAssets.length})
              </span>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
