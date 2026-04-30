/**
 * Aggregator endpoint for the Sui Lending dashboard.
 *
 * Returns a single JSON payload matching the SCHEMA.js shape consumed by the
 * static `sui-lending-dashboard` frontend. Avoids the frontend doing 5+
 * round-trips by joining all protocols' latest snapshots, time series, and
 * recent liquidations on the server side.
 *
 * Cached at the edge for 60s — pool data updates daily anyway, and a 60s
 * stale-while-revalidate window keeps the dashboard snappy.
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listProtocols } from '@/protocols/registry';

export const dynamic = 'force-dynamic';

// Frontend's protocol palette — keep in sync with sui-lending-dashboard data.js
const PROTOCOL_COLOR: Record<string, string> = {
  navi:      '#4DA2FF',
  suilend:   '#FF6B35',
  scallop:   '#7B61FF',
  alphalend: '#00C896',
  bucket:    '#E5B345',
};
const PROTOCOL_ARCHETYPE: Record<string, 'pool' | 'cdp'> = {
  navi: 'pool', suilend: 'pool', scallop: 'pool', alphalend: 'pool', bucket: 'cdp',
};

interface SnapshotRow {
  protocol: string;
  symbol: string;
  timestamp: Date;
  totalSupply: number;
  totalSupplyUsd: number;
  totalBorrows: number;
  totalBorrowsUsd: number;
  availableLiquidityUsd: number;
  supplyApy: number;
  borrowApy: number;
  utilization: number;
  price: number;
}

interface DailyRow {
  protocol: string;
  symbol: string;
  date: Date;
  closeTotalSupplyUsd: number;
  closeTotalBorrowsUsd: number;
  closeLiquidityUsd: number;
  avgSupplyApy: number;
  avgBorrowApy: number;
}

interface LiquidationRow {
  id: string;
  protocol: string;
  txDigest: string;
  timestamp: Date;
  liquidator: string;
  borrower: string;
  collateralAsset: string;
  collateralAmount: number;
  collateralUsd: number;
  debtAsset: string;
  debtAmount: number;
  debtUsd: number;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'No database configured' }, { status: 503, headers: CORS });
  }

  try {
    // ── Protocols ────────────────────────────────────────────
    const protocols = listProtocols()
      .filter((p) => p.type === 'lending')
      .map((p) => ({
        id: p.slug,
        name: p.name,
        color: PROTOCOL_COLOR[p.slug] ?? p.color,
        archetype: PROTOCOL_ARCHETYPE[p.slug] ?? 'pool',
      }));

    // ── Latest snapshot per (protocol, symbol) ──────────────
    // Using a CTE since Prisma's groupBy doesn't support DISTINCT ON.
    const latestRows = (await db.$queryRawUnsafe(`
      SELECT DISTINCT ON (protocol, symbol)
        protocol, symbol, timestamp,
        "totalSupply"::float8, "totalSupplyUsd"::float8,
        "totalBorrows"::float8, "totalBorrowsUsd"::float8,
        "availableLiquidityUsd"::float8,
        "supplyApy"::float8, "borrowApy"::float8,
        utilization::float8, price::float8
      FROM "PoolSnapshot"
      ORDER BY protocol, symbol, timestamp DESC
    `)) as SnapshotRow[];

    // Pools (for pool-archetype protocols)
    const pools = latestRows
      .filter((r) => PROTOCOL_ARCHETYPE[r.protocol] === 'pool')
      .map(toPoolRow);

    // Vaults (Bucket — CDP)
    const vaults = latestRows
      .filter((r) => PROTOCOL_ARCHETYPE[r.protocol] === 'cdp')
      .map(toVaultRow);

    // ── Time series — 90d daily TVL/supply/borrow per protocol ──
    const days = 90;
    const since = new Date(Date.now() - days * 86400 * 1000);
    const dailyRows = (await db.$queryRawUnsafe(`
      SELECT protocol, symbol, date,
        "closeTotalSupplyUsd"::float8, "closeTotalBorrowsUsd"::float8,
        "closeLiquidityUsd"::float8, "avgSupplyApy"::float8, "avgBorrowApy"::float8
      FROM "PoolDaily"
      WHERE date >= $1
      ORDER BY protocol, date
    `, since)) as DailyRow[];

    // Aggregate per protocol per day → tvlSeries
    // Map<protocol, Map<dayIndex, { supply, borrow, liquidity }>>
    const dayKey = (d: Date) => Math.floor((d.getTime() - since.getTime()) / 86400000);
    const aggByProto = new Map<string, Array<{ day: number; supply: number; borrow: number; liquidity: number }>>();
    for (const r of dailyRows) {
      const k = dayKey(r.date);
      if (k < 0 || k >= days) continue;
      let arr = aggByProto.get(r.protocol);
      if (!arr) { arr = Array.from({ length: days }, (_, i) => ({ day: i, supply: 0, borrow: 0, liquidity: 0 })); aggByProto.set(r.protocol, arr); }
      arr[k].supply    += r.closeTotalSupplyUsd  || 0;
      arr[k].borrow    += r.closeTotalBorrowsUsd || 0;
      arr[k].liquidity += r.closeLiquidityUsd    || 0;
    }

    // Build tvlSeries — frontend expects `[ [{day, value, protocol}, ...], ... ]`
    // ordered by `protocols` array. Missing days fall back to 0.
    const tvlSeries = protocols.map((p) => {
      const arr = aggByProto.get(p.id) ?? Array.from({ length: days }, (_, i) => ({ day: i, supply: 0, borrow: 0, liquidity: 0 }));
      return arr.map((d) => ({ day: d.day, value: (d.supply - d.borrow) / 1e6, protocol: p.id }));
    });
    const tvlMetricSeries = {
      tvl:     tvlSeries,
      supply:  protocols.map((p) => {
        const arr = aggByProto.get(p.id) ?? [];
        return arr.length ? arr.map((d) => ({ day: d.day, value: d.supply / 1e6, protocol: p.id }))
          : Array.from({ length: days }, (_, i) => ({ day: i, value: 0, protocol: p.id }));
      }),
      borrow:  protocols.map((p) => {
        const arr = aggByProto.get(p.id) ?? [];
        return arr.length ? arr.map((d) => ({ day: d.day, value: d.borrow / 1e6, protocol: p.id }))
          : Array.from({ length: days }, (_, i) => ({ day: i, value: 0, protocol: p.id }));
      }),
      revenue: protocols.map((p) => {
        const arr = aggByProto.get(p.id) ?? [];
        // Approximate daily revenue ≈ borrow × avg-borrow-APY × reserve-factor; we don't
        // have reserveFactor at daily granularity, so use a coarse 10% proxy.
        return arr.length ? arr.map((d) => ({ day: d.day, value: (d.borrow * 0.10) / 365 / 1e6, protocol: p.id }))
          : Array.from({ length: days }, (_, i) => ({ day: i, value: 0, protocol: p.id }));
      }),
    };

    // ── Volume series (cross-protocol aggregate) ────────────
    const volumeSeries = Array.from({ length: days }, (_, i) => {
      let supply = 0, borrow = 0, liquid = 0;
      for (const arr of aggByProto.values()) {
        supply += (arr[i]?.supply || 0) / 1e6;
        borrow += (arr[i]?.borrow || 0) / 1e6;
      }
      // Liquidations placeholder (filled below from liquidationSeries)
      return { day: i, supply, borrow, liquid };
    });

    // ── Recent liquidations (last 30 days) ──────────────────
    const since30 = new Date(Date.now() - 30 * 86400 * 1000);
    const liqRows = (await db.$queryRawUnsafe(`
      SELECT id, protocol, "txDigest", timestamp, liquidator, borrower,
        "collateralAsset", "collateralAmount"::float8, "collateralUsd"::float8,
        "debtAsset", "debtAmount"::float8, "debtUsd"::float8
      FROM "LiquidationEvent"
      WHERE timestamp >= $1
      ORDER BY timestamp DESC
      LIMIT 500
    `, since30)) as LiquidationRow[];

    const liquidations = liqRows.map((l) => ({
      t: l.timestamp.toISOString(),
      protocol: l.protocol,
      market: l.debtAsset,
      debtAsset: l.debtAsset,
      collateralAsset: l.collateralAsset,
      debtRepaidUsd: l.debtUsd,
      collateralSeizedUsd: l.collateralUsd,
      bonusUsd: Math.max(0, l.collateralUsd - l.debtUsd),
      liquidator: shortenAddr(l.liquidator),
      borrower: shortenAddr(l.borrower),
      txDigest: l.txDigest,
      healthFactor: 0.95, // not stored — placeholder
    }));

    // Daily liquidation aggregates
    const liquidationSeries = Array.from({ length: 30 }, (_, i) => {
      const dayStart = new Date(since30.getTime() + i * 86400 * 1000);
      const dayEnd   = new Date(since30.getTime() + (i + 1) * 86400 * 1000);
      const dayEvents = liqRows.filter((l) => l.timestamp >= dayStart && l.timestamp < dayEnd);
      const byProtocol: Record<string, number> = {};
      for (const p of protocols) byProtocol[p.id] = 0;
      for (const e of dayEvents) byProtocol[e.protocol] = (byProtocol[e.protocol] || 0) + (e.debtUsd || 0);
      return {
        day: i,
        count: dayEvents.length,
        totalRepaidUsd: dayEvents.reduce((s, e) => s + (e.debtUsd || 0), 0),
        byProtocol,
      };
    });

    // Patch volumeSeries with daily liquidation totals (last 30d)
    for (let i = 0; i < 30; i++) {
      const idx = days - 30 + i;
      if (idx >= 0 && idx < days) volumeSeries[idx].liquid = liquidationSeries[i].totalRepaidUsd / 1e6;
    }

    // ── Protocol metrics (for KPI strip) ────────────────────
    const protocolMetrics = protocols.map((p) => {
      const protoLatest = latestRows.filter((r) => r.protocol === p.id);
      const supply = protoLatest.reduce((s, r) => s + (r.totalSupplyUsd || 0), 0);
      const borrow = protoLatest.reduce((s, r) => s + (r.totalBorrowsUsd || 0), 0);
      // Coarse revenue estimate: 10% reserve × avg borrow APY × borrow / 365 → daily revenue
      // Annual: borrow × avg-bAPY × 0.10
      const avgBApy = protoLatest.length
        ? protoLatest.reduce((s, r) => s + (r.borrowApy || 0), 0) / protoLatest.length
        : 0;
      const fees = (borrow * (avgBApy / 100) * 0.10) / 1e6; // $M
      return {
        id: p.id,
        tvl: (supply - borrow) / 1e6,
        supply: supply / 1e6,
        borrow: borrow / 1e6,
        users: 0, // wallet-position rollups (deferred)
        fees,
      };
    });

    // ── KPI sparklines (last 30 days, aggregate across protocols) ──
    const sumDay = (i: number, key: 'supply' | 'borrow' | 'liquidity') => {
      let s = 0;
      for (const arr of aggByProto.values()) s += (arr[i]?.[key] || 0) / 1e6;
      return s;
    };
    const kpiSparks = {
      tvl:     Array.from({ length: 30 }, (_, i) => sumDay(days - 30 + i, 'liquidity')),
      supply:  Array.from({ length: 30 }, (_, i) => sumDay(days - 30 + i, 'supply')),
      borrow:  Array.from({ length: 30 }, (_, i) => sumDay(days - 30 + i, 'borrow')),
      revenue: Array.from({ length: 30 }, (_, i) => sumDay(days - 30 + i, 'borrow') * 0.10 / 365),
      users:   Array.from({ length: 30 }, () => 0),
      liq:     Array.from({ length: 30 }, (_, i) => liquidationSeries[i]?.count ?? 0),
    };

    // ── Heatmap stub (no per-hour data yet) ─────────────────
    const heatmapMetrics = {
      tx:     Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
      volume: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
      liquid: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
    };

    // ── Ticker (snapshot prices from latest pool data) ──────
    const tickerSyms = ['SUI', 'USDC', 'USDT', 'WETH', 'WBTC', 'CETUS', 'NAVX', 'SCA'];
    const ticker = tickerSyms
      .map((sym) => {
        const row = latestRows.find((r) => r.symbol === sym);
        return row ? { sym, price: row.price, ch: 0 } : null;
      })
      .filter((t): t is NonNullable<typeof t> => !!t);

    return NextResponse.json({
      protocols,
      pools,
      vaults,
      tvlSeries,
      tvlMetricSeries,
      volumeSeries,
      protocolMetrics,
      kpiSparks,
      heatmapMetrics,
      liquidations,
      liquidationSeries,
      ticker,
      days,
      generatedAt: new Date().toISOString(),
    }, {
      headers: {
        ...CORS,
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('[api/sui-lending] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: CORS },
    );
  }
}

// ─── Row mappers (snapshot row → frontend pool/vault shape) ───────────────

function toPoolRow(r: SnapshotRow) {
  // Compute a 30-element sparkline placeholder. Real values would need a
  // separate query (per-symbol PoolDaily); for now spark is a flat trend.
  const baseValue = r.totalSupplyUsd / 1e6;
  return {
    sym: r.symbol,
    name: r.symbol,
    protocol: r.protocol,
    supply: r.totalSupplyUsd / 1e6,
    borrow: r.totalBorrowsUsd / 1e6,
    supplyApy: r.supplyApy,
    borrowApy: r.borrowApy,
    util: r.utilization,
    risk: riskTier(r.utilization, r.borrowApy),
    spark: Array.from({ length: 30 }, () => baseValue),
    suppliers: 0,
    borrowers: 0,
    ltv: 0,
    liqThreshold: 0,
    reserveFactor: 0,
    irmKink: 80,
    oracleSource: r.protocol === 'navi' || r.protocol === 'suilend' || r.protocol === 'scallop' || r.protocol === 'alphalend' ? 'Pyth' : 'Pyth',
    apyHistory: Array.from({ length: 90 }, (_, i) => ({ day: i, supply: r.supplyApy, borrow: r.borrowApy })),
    history:    Array.from({ length: 90 }, (_, i) => ({ day: i, supply: baseValue, borrow: r.totalBorrowsUsd / 1e6 })),
  };
}

function toVaultRow(r: SnapshotRow) {
  return {
    sym: r.symbol,
    protocol: r.protocol,
    collateralUsd: r.totalSupplyUsd / 1e6,
    debtUsd: r.totalBorrowsUsd / 1e6,
    interestRate: r.borrowApy,
    redemptionFee: 0.5,
    psmFee: 0.1,
    minCR: 110,
    risk: riskTier(r.utilization, r.borrowApy),
    spark: Array.from({ length: 30 }, () => r.totalSupplyUsd / 1e6),
  };
}

function riskTier(util: number, borrowApy: number): 'safe' | 'moderate' | 'high' {
  if (borrowApy > 30 || util > 95) return 'high';
  if (borrowApy > 10 || util > 80) return 'moderate';
  return 'safe';
}

function shortenAddr(s: string): string {
  if (!s) return '';
  if (s.length <= 14) return s;
  return s.slice(0, 6) + '..' + s.slice(-4);
}
