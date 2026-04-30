'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { calcInterestRateCurve } from '@/lib/pools';
import { formatPercent } from '@/lib/utils';

interface InterestRateCurveProps {
  baseRate: number;
  multiplier: number;
  jumpMultiplier: number;
  kink: number;
  reserveFactor: number;
  currentUtilization?: number;
}

export default function InterestRateCurve({
  baseRate,
  multiplier,
  jumpMultiplier,
  kink,
  reserveFactor,
  currentUtilization,
}: InterestRateCurveProps) {
  const data = calcInterestRateCurve({
    baseRate,
    multiplier,
    jumpMultiplier,
    kink,
    reserveFactor,
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="utilization"
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: '#71717a', fontSize: 11 }}
            axisLine={{ stroke: '#27272a' }}
            label={{ value: 'Utilization', position: 'insideBottom', offset: -5, fill: '#71717a', fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v) => formatPercent(v)}
            tick={{ fill: '#71717a', fontSize: 11 }}
            axisLine={{ stroke: '#27272a' }}
            width={60}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number | undefined, name: string | undefined) => [
              formatPercent(value ?? 0),
              name === 'borrowRate' ? 'Borrow APY' : 'Supply APY',
            ]}
            labelFormatter={(v) => `Utilization: ${v}%`}
          />
          {/* Kink marker */}
          <ReferenceLine
            x={kink * 100}
            stroke="#F59E0B"
            strokeDasharray="5 5"
            label={{ value: 'Kink', fill: '#F59E0B', fontSize: 10 }}
          />
          {/* Current utilization marker */}
          {currentUtilization !== undefined && (
            <ReferenceLine
              x={currentUtilization}
              stroke="#22C55E"
              strokeWidth={2}
              label={{ value: 'Current', fill: '#22C55E', fontSize: 10 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="borrowRate"
            stroke="#EF4444"
            dot={false}
            strokeWidth={2}
            name="borrowRate"
          />
          <Line
            type="monotone"
            dataKey="supplyRate"
            stroke="#22C55E"
            dot={false}
            strokeWidth={2}
            name="supplyRate"
          />
        </LineChart>
      </ResponsiveContainer>
  );
}
