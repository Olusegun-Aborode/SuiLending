'use client';

import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatUsd, getAssetColor } from '@/lib/utils';

interface DonutChartProps {
  data: Array<{ name: string; value: number }>;
}

/**
 * "Other" groups tiny slices so the ring doesn't turn into a confetti of
 * unreadable 0.1% wedges. A slice is eligible to stay individual if it's
 * at least OTHER_MIN_PCT of the total AND we haven't already kept
 * TOP_N assets.
 */
const TOP_N = 8;
const OTHER_MIN_PCT = 2;
const OTHER_LABEL = 'Other';
const OTHER_COLOR = '#9CA3AF';

// Cap the number of *labeled* slices so two donuts rendered side by side
// look similarly dense — otherwise the chart with more pairs spreads a
// thicket of leader-lines across its panel and reads as wider than the
// other. Unlabeled slices still render as colored wedges and appear in
// the hover tooltip.
const MAX_LABELS = 4;

interface SliceLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  name: string;
  value: number;
  percent?: number;
  index: number;
}

/**
 * DonutChart — enhanced donut with:
 *   - Top-N individual slices; everything smaller rolls into "Other"
 *   - Leader-line labels showing `{symbol} ${value} ({pct}%)`
 *   - Center total in the hole
 *   - Tooltip on hover with the same symbol + value + percentage breakdown
 */
export default function DonutChart({ data }: DonutChartProps) {
  const { slices, total } = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    const rawTotal = sorted.reduce((s, d) => s + d.value, 0);

    if (rawTotal <= 0) return { slices: [], total: 0 };

    const kept: Array<{ name: string; value: number }> = [];
    let otherSum = 0;

    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const pct = (s.value / rawTotal) * 100;
      if (kept.length < TOP_N && pct >= OTHER_MIN_PCT) kept.push(s);
      else otherSum += s.value;
    }

    if (otherSum > 0) kept.push({ name: OTHER_LABEL, value: otherSum });
    return { slices: kept, total: rawTotal };
  }, [data]);

  if (slices.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-xs"
        style={{ color: 'var(--fg-muted)' }}
      >
        No data available
      </div>
    );
  }

  const colorFor = (name: string) =>
    name === OTHER_LABEL ? OTHER_COLOR : getAssetColor(name);

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 12, right: 56, bottom: 12, left: 56 }}>
          {/* Fixed pixel radii (not percentages) — Recharts will otherwise
              auto-shrink the pie to fit its leader-line labels, so two
              donuts side-by-side render at different visible sizes when
              one has long labels and the other has short ones. */}
          <Pie
            data={slices}
            cx="50%"
            cy="50%"
            innerRadius={72}
            outerRadius={104}
            paddingAngle={2}
            dataKey="value"
            stroke="var(--surface)"
            strokeWidth={2}
            label={(props) => renderSliceLabel(props, total)}
            labelLine={{ stroke: 'var(--fg-dim)', strokeWidth: 1 }}
            isAnimationActive={false}
          >
            {slices.map((entry) => (
              <Cell key={entry.name} fill={colorFor(entry.name)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--fg)',
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              color: 'var(--bg)',
              padding: '6px 10px',
            }}
            itemStyle={{ color: 'var(--bg)' }}
            formatter={(value, name) => {
              const v = typeof value === 'number' ? value : 0;
              const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
              return [`${formatUsd(v, true)} (${pct}%)`, name ?? ''];
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Center total — sits inside the donut hole. pointer-events:none so
          the underlying Recharts hover still works. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            30d Total
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--fg)',
              letterSpacing: '-0.01em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatUsd(total, true)}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Leader-line label rendered just outside each slice:
 *   `{symbol} ${value} ({pct}%)`
 *
 * Drops labels for:
 *   - slices beyond the top MAX_LABELS (rank-capped so two donuts stay
 *     visually similar regardless of slice count)
 *   - slices under 3% of total (would overlap neighbors regardless)
 *
 * Unlabeled slices still render as colored wedges; tooltip has all data.
 */
function renderSliceLabel(raw: unknown, total: number): React.ReactElement | null {
  const p = raw as SliceLabelProps;
  if (total <= 0) return null;
  if (p.index >= MAX_LABELS) return null; // cap labeled slices
  const pct = (p.value / total) * 100;
  if (pct < 3) return null; // tiny slices; tooltip carries the info

  const RAD = Math.PI / 180;
  const r = p.outerRadius + 16;
  const x = p.cx + r * Math.cos(-p.midAngle * RAD);
  const y = p.cy + r * Math.sin(-p.midAngle * RAD);
  const onRight = x > p.cx;

  return (
    <text
      x={x}
      y={y}
      fill="var(--fg)"
      fontSize={11}
      fontFamily="var(--font-mono)"
      textAnchor={onRight ? 'start' : 'end'}
      dominantBaseline="central"
    >
      <tspan fontWeight={600}>{p.name}</tspan>
      <tspan fill="var(--fg-muted)" dx={6}>
        {formatUsd(p.value, true)}
      </tspan>
      <tspan fill="var(--fg-dim)" dx={4}>
        ({pct.toFixed(1)}%)
      </tspan>
    </text>
  );
}
