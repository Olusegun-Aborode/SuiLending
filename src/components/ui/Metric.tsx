import type { ReactNode } from 'react';
import InfoTooltip from '@/components/InfoTooltip';

interface MetricProps {
  label: string;
  value: ReactNode;
  delta?: { value: string; direction: 'up' | 'down' };
  tooltip?: string;
  selected?: boolean;
  onClick?: () => void;
}

/**
 * Metric — a single KPI cell. Typically rendered in a row inside a Panel with
 * `flush` so the borders join up cleanly.
 */
export default function Metric({ label, value, delta, tooltip, selected, onClick }: MetricProps) {
  return (
    <div
      className={`metric ${selected ? 'selected' : ''}`.trim()}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="metric-label">
        <span>{label}</span>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <div className="metric-value">{value}</div>
      {delta && (
        <div className="metric-footer">
          <span className={`delta ${delta.direction}`}>
            {delta.direction === 'up' ? '▲' : '▼'} {delta.value}
          </span>
        </div>
      )}
    </div>
  );
}
