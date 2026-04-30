'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Panel from '@/components/ui/Panel';
import ChartPanel from '@/components/ui/ChartPanel';
import PageHeader from '@/components/ui/PageHeader';
import Metric from '@/components/ui/Metric';
import Loading from '@/components/ui/Loading';
import ErrorMsg from '@/components/ui/ErrorMsg';
import SimpleLineChart from '@/components/charts/SimpleLineChart';
import InterestRateCurve from '@/components/charts/InterestRateCurve';
import DonutChart from '@/components/charts/DonutChart';
import InfoTooltip from '@/components/InfoTooltip';
import { formatUsd, formatPercent, formatNumber, getAssetColor } from '@/lib/utils';

interface PoolDetail {
  symbol: string;
  totalSupply: number;
  totalSupplyUsd: number;
  totalBorrows: number;
  totalBorrowsUsd: number;
  availableLiquidity: number;
  availableLiquidityUsd: number;
  supplyApy: number;
  borrowApy: number;
  utilization: number;
  ltv: number;
  liquidationThreshold: number;
  supplyCapCeiling: number;
  borrowCapCeiling: number;
  price: number;
}
interface RateModel {
  baseRate: number;
  multiplier: number;
  jumpMultiplier: number;
  kink: number;
  reserveFactor: number;
}
interface HistoryRow {
  date: string;
  avgSupplyApy: number;
  avgBorrowApy: number;
  avgUtilization: number;
}
interface PairData {
  collateralAsset: string;
  borrowAsset: string;
  totalCollateralUsd: number;
  totalBorrowUsd: number;
}
interface DetailResponse {
  pool: PoolDetail | null;
  rateModel: RateModel | null;
  history: HistoryRow[];
  pairs: { asCollateral: PairData[]; asBorrow: PairData[] };
  assetColor?: string;
  assetName?: string;
}

export default function MarketDetailPage({
  params,
}: {
  params: Promise<{ protocol: string; symbol: string }>;
}) {
  const { protocol, symbol } = use(params);
  const upperSymbol = symbol.toUpperCase();

  // Shared time-range state across the two history charts (matches the
  // Overview page pattern). Interest Rate Curve + the pair donuts don't
  // move with this: the curve is param-based, and the pairs come from a
  // snapshot aggregate with no per-day dimension in the schema.
  const [days, setDays] = useState(30);

  const { data, isPending, isError, refetch } = useQuery<DetailResponse>({
    queryKey: ['poolDetail', protocol, upperSymbol, days],
    queryFn: () =>
      fetch(`/api/${protocol}/pools/${upperSymbol}?days=${days}`).then((r) => r.json()),
  });

  if (isPending) return <Loading message={`Loading ${upperSymbol}`} />;
  if (isError)
    return <ErrorMsg message={`Failed to load ${upperSymbol}.`} onRetry={() => refetch()} />;

  const { pool, rateModel, history, pairs } = data;
  const assetColor = data.assetColor ?? getAssetColor(upperSymbol);
  const assetName = data.assetName ?? upperSymbol;

  const rateHistory = history.map((h) => ({
    date: h.date,
    supplyApy: h.avgSupplyApy,
    borrowApy: h.avgBorrowApy,
  }));
  const utilHistory = history.map((h) => ({ date: h.date, utilization: h.avgUtilization }));
  const borrowedAgainst = pairs.asCollateral.map((p) => ({
    name: p.borrowAsset,
    value: p.totalBorrowUsd,
  }));
  const collateralUsed = pairs.asBorrow.map((p) => ({
    name: p.collateralAsset,
    value: p.totalCollateralUsd,
  }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: assetColor,
                display: 'inline-block',
              }}
            />
            {upperSymbol}
          </span>
        }
        subtitle={assetName}
        actions={
          <Link href={`/${protocol}/markets`} className="dropdown-trigger">
            <ArrowLeft size={12} />
            Back to Markets
          </Link>
        }
      />

      <Panel title={`${upperSymbol} Overview`} badge="LIVE" flush>
        <div className="grid grid-4">
          <Metric
            label="Total Supply"
            value={pool ? formatUsd(pool.totalSupplyUsd, true) : '—'}
          />
          <Metric
            label="Total Borrows"
            value={pool ? formatUsd(pool.totalBorrowsUsd, true) : '—'}
          />
          <Metric label="Supply APY" value={pool ? formatPercent(pool.supplyApy) : '—'} />
          <Metric label="Borrow APY" value={pool ? formatPercent(pool.borrowApy) : '—'} />
        </div>
      </Panel>

      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <Panel title="Interest Rate Model">
          {rateModel ? (
            <KvList
              rows={[
                ['Base Rate', formatPercent(rateModel.baseRate * 100)],
                ['Multiplier', formatPercent(rateModel.multiplier * 100)],
                ['Jump Multiplier', formatPercent(rateModel.jumpMultiplier * 100)],
                ['Kink', formatPercent(rateModel.kink * 100)],
                ['Reserve Factor', formatPercent(rateModel.reserveFactor * 100)],
              ]}
            />
          ) : (
            <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              Rate model params not yet indexed
            </p>
          )}
        </Panel>
        <Panel title="Risk Parameters">
          <KvList
            rows={[
              ['LTV', pool ? formatPercent(pool.ltv * 100) : '—', 'Maximum borrow power per unit of collateral'],
              [
                'Liquidation Threshold',
                pool ? formatPercent(pool.liquidationThreshold * 100) : '—',
                'Health factor drops below 1 when borrows exceed this ratio of collateral',
              ],
              ['Utilization', pool ? formatPercent(pool.utilization) : '—'],
              ['Supply Cap', pool ? formatNumber(pool.supplyCapCeiling) : '—'],
              ['Borrow Cap', pool ? formatNumber(pool.borrowCapCeiling) : '—'],
              ['Price', pool ? formatUsd(pool.price) : '—'],
            ]}
          />
        </Panel>
      </div>

      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <ChartPanel
          title="Interest Rate History"
          badge={`${days}D`}
          timeRanges={[7, 30, 90]}
          selectedRange={days}
          onRangeChange={setDays}
        >
          <SimpleLineChart
            data={rateHistory}
            lines={[
              { dataKey: 'supplyApy', color: 'var(--green)', name: 'Supply APY' },
              { dataKey: 'borrowApy', color: 'var(--red)', name: 'Borrow APY' },
            ]}
          />
        </ChartPanel>
        <ChartPanel
          title="Utilization History"
          badge={`${days}D`}
          timeRanges={[7, 30, 90]}
          selectedRange={days}
          onRangeChange={setDays}
        >
          <SimpleLineChart
            data={utilHistory}
            lines={[{ dataKey: 'utilization', color: 'var(--blue)', name: 'Utilization' }]}
          />
        </ChartPanel>
      </div>

      {rateModel && (
        <ChartPanel title="Interest Rate Curve" badge="MODEL">
          <InterestRateCurve
            baseRate={rateModel.baseRate}
            multiplier={rateModel.multiplier}
            jumpMultiplier={rateModel.jumpMultiplier}
            kink={rateModel.kink}
            reserveFactor={rateModel.reserveFactor}
            currentUtilization={pool?.utilization}
          />
        </ChartPanel>
      )}

      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <ChartPanel title={`Debt backed by ${upperSymbol}`} badge="ALL">
          <DonutChart data={borrowedAgainst} />
        </ChartPanel>
        <ChartPanel title={`Collateral backing ${upperSymbol} debt`} badge="ALL">
          <DonutChart data={collateralUsed} />
        </ChartPanel>
      </div>
    </div>
  );
}

function KvList({ rows }: { rows: Array<[string, string, string?]> }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        rowGap: 8,
        columnGap: 16,
        fontSize: 12,
      }}
    >
      {rows.map(([k, v, tooltip]) => (
        <span key={k} className="contents">
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--fg-muted)' }}
          >
            {k}
            {tooltip && <InfoTooltip text={tooltip} />}
          </span>
          <span
            style={{
              textAlign: 'right',
              color: 'var(--fg)',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {v}
          </span>
        </span>
      ))}
    </div>
  );
}
