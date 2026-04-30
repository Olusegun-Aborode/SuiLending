import type { ReactNode } from 'react';
import Panel from './Panel';
import TimeRange from './TimeRange';

interface ChartPanelProps {
  title: string;
  badge?: ReactNode;
  timeRanges?: number[];
  selectedRange?: number;
  onRangeChange?: (v: number) => void;
  actions?: ReactNode;
  height?: number;
  children: ReactNode;
}

/**
 * ChartPanel — a Panel tuned for chart embeds. The header exposes an optional
 * time-range toggle; the body gets a fixed height so Recharts'
 * ResponsiveContainer has something to measure.
 */
export default function ChartPanel({
  title,
  badge,
  timeRanges,
  selectedRange,
  onRangeChange,
  actions,
  height = 320,
  children,
}: ChartPanelProps) {
  const headerActions = (
    <>
      {timeRanges && selectedRange !== undefined && onRangeChange && (
        <TimeRange options={timeRanges} value={selectedRange} onChange={onRangeChange} />
      )}
      {actions}
    </>
  );

  return (
    <Panel title={title} badge={badge} actions={headerActions}>
      <div style={{ height }}>{children}</div>
    </Panel>
  );
}
