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
import { fetchScallopCanonicalTvl } from '@/lib/prices';

// ─── Per-protocol TVL formula ─────────────────────────────────────────────
//
// Each lending protocol on Sui defines TVL its own way on its own UI.
// User-verified ground-truth from each protocol's own dashboard:
//   - NAVI:      $152.36M = supply − borrow
//   - Suilend:   "TVL: $136M" = deposits ($188M) − borrows ($52.4M)
//   - Scallop:   $20.20M from their indexer's canonical tvl field
//   - AlphaLend: "Available Liquidity: $72.7M" = supply ($131M) − borrow ($58.7M)
//   - Bucket:    $51.57M reported on app.bucketprotocol.io (gross collateral)
//
// Pattern: every pool-based lending protocol uses (supply − borrow) for the
// number they label "TVL" / "Available Liquidity". CDP protocols (Bucket)
// use gross collateral. Scallop is the only one that publishes a single
// canonical number we fetch directly.
//
// 'net'    = (supply − borrow) / 1e6
// 'gross'  = supply / 1e6
// 'remote' = fetched from the protocol's own canonical endpoint
type TvlMethod = 'net' | 'gross' | 'remote';
const PROTOCOL_TVL_METHOD: Record<string, TvlMethod> = {
  navi:      'net',      // app.naviprotocol.io  → $152.36M
  suilend:   'net',      // suilend.fi          → "TVL: $136M"
  scallop:   'remote',   // sdk.api.scallop.io   → $20.20M (indexer.tvl)
  alphalend: 'net',      // alphalend.xyz       → "Available Liquidity: $72.7M"
  bucket:    'gross',    // app.bucketprotocol.io → $51.57M (gross collateral, coverage gap)
};

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
    //
    // Critical freshness filter: only consider snapshots from the last 24h.
    // Without this, dead pools — symbols a protocol used to index but doesn't
    // anymore (e.g. NAVI renamed USDT→suiUSDT, XBTC→xBTC) — keep their old
    // last-recorded snapshot at the top of their (protocol, symbol) bucket
    // forever. If that old snapshot was written under a buggy scaling pass,
    // the dead row inflates protocol TVL by orders of magnitude. The crons
    // tick at most every hour for the slowest protocol, so 24h is loose
    // enough for a reasonable downtime margin and tight enough to drop
    // anything older than a single missed refresh cycle.
    const SNAPSHOT_FRESHNESS_HOURS = 24;
    const freshSince = new Date(Date.now() - SNAPSHOT_FRESHNESS_HOURS * 3600 * 1000);
    const latestRows = (await db.$queryRawUnsafe(`
      SELECT DISTINCT ON (protocol, symbol)
        protocol, symbol, timestamp,
        "totalSupply"::float8, "totalSupplyUsd"::float8,
        "totalBorrows"::float8, "totalBorrowsUsd"::float8,
        "availableLiquidityUsd"::float8,
        "supplyApy"::float8, "borrowApy"::float8,
        utilization::float8, price::float8
      FROM "PoolSnapshot"
      WHERE timestamp >= $1
      ORDER BY protocol, symbol, timestamp DESC
    `, freshSince)) as SnapshotRow[];

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
    //
    // Per-protocol formula matches what each protocol publishes about itself
    // (see PROTOCOL_TVL_METHOD top of file): NAVI shows supply−borrow on its
    // own UI, others show gross. We keep the historical chart in the same
    // formula as the headline TVL so the right edge of the stacked area
    // exactly equals the per-protocol KPI number — no "wait, why is the
    // chart number different" confusion. Scallop's 'remote' method has no
    // historical series available, so its history uses gross supply (the
    // closest proxy our PoolDaily aggregator captures).
    const tvlSeries = protocols.map((p) => {
      const arr = aggByProto.get(p.id) ?? Array.from({ length: days }, (_, i) => ({ day: i, supply: 0, borrow: 0, liquidity: 0 }));
      const method = PROTOCOL_TVL_METHOD[p.id] ?? 'gross';
      return arr.map((d) => {
        const value = method === 'net'
          ? (d.supply - d.borrow) / 1e6
          : d.supply / 1e6;
        return { day: d.day, value, protocol: p.id };
      });
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

    // ── User counts ─────────────────────────────────────────
    // Coarse signal: distinct borrowers in the last 30 days of liquidations,
    // plus distinct wallet-position addresses (NAVI-only today). Not the
    // total active-user count — but it's a real on-chain signal vs the
    // hard-coded 0 we had before.
    const userCountRows = (await db.$queryRawUnsafe(`
      SELECT protocol, count(DISTINCT borrower)::int AS users
      FROM "LiquidationEvent"
      WHERE timestamp >= $1
      GROUP BY protocol
    `, since30)) as Array<{ protocol: string; users: number }>;
    const walletPosRows = (await db.$queryRawUnsafe(`
      SELECT protocol, count(*)::int AS users
      FROM "WalletPosition"
      GROUP BY protocol
    `)) as Array<{ protocol: string; users: number }>;
    const usersByProto: Record<string, number> = {};
    for (const r of userCountRows) usersByProto[r.protocol] = (usersByProto[r.protocol] || 0) + r.users;
    for (const r of walletPosRows)  usersByProto[r.protocol] = Math.max(usersByProto[r.protocol] || 0, r.users);

    // ── DefiLlama TVL reference (transparency, NOT override) ───────
    // We used to override our `tvl` with DefiLlama's headline number for
    // protocols where on-chain coverage fell short — masking the gap with a
    // pretty headline that didn't tie out to anything we'd verified. New
    // policy: dashboard always reports what we actually indexed on-chain.
    // We still fetch DefiLlama as a *reference* and surface it alongside
    // ours (`tvlReference` + `tvlCoverage`) so users can see when our
    // coverage falls short of the publicly-known figure and by how much,
    // rather than us papering over the gap. Honesty over headline parity.
    const llamaSlugs: Record<string, string> = { bucket: 'bucket-protocol' };
    const tvlReferenceByProto: Record<string, number> = {};
    await Promise.all(
      Object.entries(llamaSlugs).map(async ([proto, slug]) => {
        try {
          const r = await fetch(`https://api.llama.fi/tvl/${slug}`, {
            headers: { 'Accept': 'application/json' },
            next: { revalidate: 300 },
          });
          if (!r.ok) return;
          const v = Number(await r.text());
          if (Number.isFinite(v) && v > 0) tvlReferenceByProto[proto] = v / 1e6; // $M
        } catch {}
      }),
    );

    // ── Protocol metrics (for KPI strip) ────────────────────
    //
    // Per-protocol TVL formula (see PROTOCOL_TVL_METHOD at top of file): each
    // protocol's number matches what its own UI displays, because protocols
    // don't agree on what "TVL" means. NAVI shows supply−borrow on their
    // app, Suilend shows gross deposits, Scallop publishes a canonical
    // indexer field that combines pools + collaterals.
    //
    // The route handler fetches Scallop's remote TVL once and threads it
    // through to the per-protocol mapper below. Runtime cost: one extra
    // 5-minute-cached HTTP call per request.
    const scallopRemoteTvlRaw = PROTOCOL_TVL_METHOD.scallop === 'remote'
      ? await fetchScallopCanonicalTvl()
      : null;

    const protocolMetrics = protocols.map((p) => {
      const protoLatest = latestRows.filter((r) => r.protocol === p.id);
      const supply = protoLatest.reduce((s, r) => s + (r.totalSupplyUsd || 0), 0);
      const borrow = protoLatest.reduce((s, r) => s + (r.totalBorrowsUsd || 0), 0);
      const grossTvl = supply / 1e6;
      const netLiquidity = (supply - borrow) / 1e6;
      const method = PROTOCOL_TVL_METHOD[p.id] ?? 'gross';
      // Apply the protocol's preferred formula. Remote-method protocols fall
      // back to gross when the remote fetch fails so the dashboard never
      // shows zero for a protocol just because their indexer is briefly down.
      let tvl: number;
      if (method === 'net') {
        tvl = netLiquidity;
      } else if (method === 'remote' && p.id === 'scallop' && scallopRemoteTvlRaw != null) {
        tvl = scallopRemoteTvlRaw / 1e6; // remote returns USD, normalize to $M
      } else {
        tvl = grossTvl;
      }
      const avgBApy = protoLatest.length
        ? protoLatest.reduce((s, r) => s + (r.borrowApy || 0), 0) / protoLatest.length
        : 0;
      const fees = (borrow * (avgBApy / 100) * 0.10) / 1e6;
      // tvlReference: DefiLlama's published TVL for the same protocol when
      // available. tvlCoverage: our number ÷ reference, capped at 1. Lets
      // the dashboard surface "we account for X% of DefiLlama's number"
      // when there's still a coverage gap (today: Bucket's LP-tokenized
      // collateral types we haven't unwrapped).
      const ref = tvlReferenceByProto[p.id];
      const coverage = ref && ref > 0 ? Math.min(1, tvl / ref) : null;
      return {
        id: p.id,
        tvl,
        tvlMethod: method,                  // 'net' | 'gross' | 'remote' — for UI badges
        netLiquidity,                       // legacy / alt-view number
        tvlReference: ref ?? null,
        tvlCoverage: coverage,
        supply: supply / 1e6,
        borrow: borrow / 1e6,
        users: usersByProto[p.id] ?? 0,
        fees,
      };
    });

    // ── Reconcile time series with live snapshot ────────────
    // Two paths produced different totals before this:
    //   • Protocol Mix uses `protocolMetrics.tvl` (PoolSnapshot, DefiLlama-overridden)
    //   • TVL by Protocol used `tvlMetricSeries.tvl` (PoolDaily, no override)
    // PoolDaily lags the live snapshot (cron runs once a day) and doesn't
    // get the DefiLlama override, so today's column in the area chart can
    // sum to half the treemap total. Fix: stamp the LATEST day of each
    // per-protocol series with the value from `protocolMetrics`. Earlier
    // days still come from PoolDaily history (so trends are honest); only
    // the right edge gets reconciled. Daily revenue uses fees÷365 to match
    // the protocolMetrics annualized estimate.
    //
    // Note: `tvlSeries` is the same array reference as `tvlMetricSeries.tvl`
    // (see assignment above), so mutating tvlMetricSeries.tvl updates both.
    for (let i = 0; i < protocols.length; i++) {
      const m = protocolMetrics[i];
      const tvlArr     = tvlMetricSeries.tvl[i];
      const supplyArr  = tvlMetricSeries.supply[i];
      const borrowArr  = tvlMetricSeries.borrow[i];
      const revenueArr = tvlMetricSeries.revenue[i];
      const last = (arr: { day: number; value: number; protocol: string }[], v: number) => {
        if (!arr.length) return;
        arr[arr.length - 1] = { ...arr[arr.length - 1], value: v };
      };
      last(tvlArr,     m.tvl);
      last(supplyArr,  m.supply);
      last(borrowArr,  m.borrow);
      last(revenueArr, m.fees / 365);
    }

    // ── KPI sparklines (last 30 days, aggregate across protocols) ──
    const sumDay = (i: number, key: 'supply' | 'borrow' | 'liquidity') => {
      let s = 0;
      for (const arr of aggByProto.values()) s += (arr[i]?.[key] || 0) / 1e6;
      return s;
    };
    const kpiSparks = {
      // tvl sparkline traces gross deposits (matches the headline TVL number)
      // — same source as `supply` since they're the same metric for lending.
      tvl:     Array.from({ length: 30 }, (_, i) => sumDay(days - 30 + i, 'supply')),
      supply:  Array.from({ length: 30 }, (_, i) => sumDay(days - 30 + i, 'supply')),
      borrow:  Array.from({ length: 30 }, (_, i) => sumDay(days - 30 + i, 'borrow')),
      revenue: Array.from({ length: 30 }, (_, i) => sumDay(days - 30 + i, 'borrow') * 0.10 / 365),
      users:   Array.from({ length: 30 }, () => 0),
      liq:     Array.from({ length: 30 }, (_, i) => liquidationSeries[i]?.count ?? 0),
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
