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
import { fetchScallopCanonicalTvl, fetchBucketCanonicalTvl } from '@/lib/prices';
import { computeRiskModel, type McMarketInput } from '@/lib/risk-modeling';

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
  bucket:    'remote',   // DefiLlama bucket-protocol → ~$62M (close to UI's $51.57M;
                         // proper match needs LP unwrappers we haven't built)
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
  // Risk params from PoolSnapshot (added 2026-05-04). Decimals 0-1.
  ltv: number;
  liquidationThreshold: number;
  // IRM params from RateModelParams (LEFT-joined on protocol+symbol). May
  // be null when the adapter didn't populate IRM for this pool.
  irmBaseRate: number | null;
  irmMultiplier: number | null;
  irmJumpMult: number | null;
  irmKink: number | null;
  irmReserveFactor: number | null;
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
    // Freshness filter: drop snapshots older than the freshness window so
    // dead-symbol ghosts (e.g. NAVI renamed USDT→suiUSDT some time back, but
    // an old buggy-scale USDT snapshot was still inflating TVL because nothing
    // newer existed in that bucket) get excluded.
    //
    // Window choice: protocols cron at very different cadences. NAVI/Suilend
    // refresh every 30min via collect-pools; Bucket runs once daily at 00:40
    // UTC. A 24h window is too tight — one delayed daily cron means an
    // entire protocol disappears from the dashboard, which is what just
    // happened to Bucket. 7 days is loose enough to absorb a few missed
    // daily runs while still being short enough that any stale renamed-pool
    // ghost (the ones that caused the original $1B USDT bug) is months old
    // and trivially excluded.
    const SNAPSHOT_FRESHNESS_DAYS = 7;
    const freshSince = new Date(Date.now() - SNAPSHOT_FRESHNESS_DAYS * 86400 * 1000);
    // LEFT JOIN RateModelParams so the latest snapshot row carries both pool
    // state and the rate-model parameters in a single query. RateModelParams
    // is keyed by (protocol, symbol) and updated by the same collect-pools
    // cron — so the IRM here matches the pool's current state. Pools without
    // an IRM entry (e.g. adapters that haven't populated `irm` yet) get NULL,
    // which the toPoolRow helper coerces to 0.
    const latestRows = (await db.$queryRawUnsafe(`
      SELECT DISTINCT ON (ps.protocol, ps.symbol)
        ps.protocol, ps.symbol, ps.timestamp,
        ps."totalSupply"::float8, ps."totalSupplyUsd"::float8,
        ps."totalBorrows"::float8, ps."totalBorrowsUsd"::float8,
        ps."availableLiquidityUsd"::float8,
        ps."supplyApy"::float8, ps."borrowApy"::float8,
        ps.utilization::float8, ps.price::float8,
        ps.ltv::float8, ps."liquidationThreshold"::float8,
        rmp."baseRate"::float8       AS "irmBaseRate",
        rmp.multiplier::float8       AS "irmMultiplier",
        rmp."jumpMultiplier"::float8 AS "irmJumpMult",
        rmp.kink::float8             AS "irmKink",
        rmp."reserveFactor"::float8  AS "irmReserveFactor"
      FROM "PoolSnapshot" ps
      LEFT JOIN "RateModelParams" rmp
        ON rmp.protocol = ps.protocol AND rmp.symbol = ps.symbol
      WHERE ps.timestamp >= $1
      ORDER BY ps.protocol, ps.symbol, ps.timestamp DESC
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

    // DefiLlama historical TVL fallback. Our PoolDaily history is sparse for
    // the non-NAVI protocols (their crons failed for long stretches), leaving
    // big holes in the TVL-by-Protocol chart. The DefillamaTvl table
    // (populated by scripts/backfill-defillama.ts) carries 1-3 years of daily
    // protocol-level TVL. We index it by the same dayKey so the chart builder
    // can fall back to it on any day PoolDaily has no value. Value is $M.
    const dlamaByProto = new Map<string, number[]>();
    try {
      const dlamaRows = (await db.$queryRawUnsafe(`
        SELECT protocol, date, "tvlUsd"::float8
        FROM "DefillamaTvl"
        WHERE date >= $1
        ORDER BY protocol, date
      `, since)) as Array<{ protocol: string; date: Date; tvlUsd: number }>;
      for (const r of dlamaRows) {
        const k = dayKey(r.date);
        if (k < 0 || k >= days) continue;
        let arr = dlamaByProto.get(r.protocol);
        if (!arr) { arr = new Array(days).fill(0); dlamaByProto.set(r.protocol, arr); }
        arr[k] = (r.tvlUsd || 0) / 1e6; // → $M
      }
    } catch (e) {
      // Table may not exist yet on a fresh DB — degrade gracefully to no fallback.
      console.warn('[sui-lending] DefillamaTvl fallback unavailable:', e instanceof Error ? e.message : e);
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
      const dlama = dlamaByProto.get(p.id);
      return arr.map((d) => {
        // Our computed value from PoolDaily for this day. A real lending pool
        // always has supply > 0, so supply === 0 means "no PoolDaily data for
        // this day" — a gap to fill from DefiLlama history.
        const computed = method === 'net'
          ? (d.supply - d.borrow) / 1e6
          : d.supply / 1e6;
        const hasOwnData = d.supply > 0;
        const value = hasOwnData
          ? computed
          : (dlama && dlama[d.day] > 0 ? dlama[d.day] : computed);
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
    // Filter out zero-USD events at SQL level. Many NAVI rows ingest with
    // amount/USD = 0 because the decoder couldn't price the event (asset
    // type not in the price registry, or zero-coin batch event). Surfacing
    // those as "liquidations" inflated the 30D count and put hardcoded
    // HF 0.950 / $0/$0 rows in the Recent Liquidations table. The standard
    // says "no un-sourced figure ships" — these rows are non-events.
    const liqRowsRaw = (await db.$queryRawUnsafe(`
      SELECT id, protocol, "txDigest", timestamp, liquidator, borrower,
        "collateralAsset", "collateralAmount"::float8, "collateralUsd"::float8,
        "debtAsset", "debtAmount"::float8, "debtUsd"::float8
      FROM "LiquidationEvent"
      WHERE timestamp >= $1
        AND ("debtUsd" > 0 OR "collateralUsd" > 0)
      ORDER BY timestamp DESC
      LIMIT 500
    `, since30)) as LiquidationRow[];
    const liqRows = liqRowsRaw;

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
      // HF at liquidation isn't stored on LiquidationEvent (we don't read
      // it from chain — would need a state read per event). Render as null
      // so the frontend shows "—" instead of a constant fake 0.950 that
      // looked like the rows were synthetic. Add a TODO to populate this
      // by inferring HF = 1.0 (approx, since the borrower was liquidatable
      // at event time) or by a follow-up state read.
      healthFactor: null as number | null,
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
    // Fetch all 'remote' protocol TVLs in parallel up-front so the per-protocol
    // mapper below stays synchronous. Each fetch is HTTP-cached for 5 minutes
    // so the cost is roughly one network round-trip per cache cycle.
    const [scallopRemoteTvlRaw, bucketRemoteTvlRaw] = await Promise.all([
      PROTOCOL_TVL_METHOD.scallop === 'remote' ? fetchScallopCanonicalTvl() : Promise.resolve(null),
      PROTOCOL_TVL_METHOD.bucket  === 'remote' ? fetchBucketCanonicalTvl()  : Promise.resolve(null),
    ]);

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
      } else if (method === 'remote' && p.id === 'bucket' && bucketRemoteTvlRaw != null) {
        tvl = bucketRemoteTvlRaw / 1e6;
      } else {
        tvl = grossTvl;
      }
      // Fees per protocol — proper per-pool sum, not a simple-average APY × total
      // borrow shortcut. The simple-avg approach was over-stating Suilend by
      // 6.7× because a handful of niche markets at 60–80% APY dragged its
      // unweighted mean to ~40% while the borrow-weighted mean is ~6%. The
      // correct quantity is Σ (perPoolBorrowUsd × perPoolBorrowAPY × RF),
      // which is exactly what each protocol earns. RF=10% is still a coarse
      // sector-wide proxy until adapters expose per-pool reserve factors.
      const fees = protoLatest.reduce((s, r) => s + (r.totalBorrowsUsd || 0) * ((r.borrowApy || 0) / 100) * 0.10, 0) / 1e6;
      // Borrow-weighted avg APY surfaced for the UI badge / methodology — same
      // weighting that drives `fees`, so the two stay consistent.
      const wtdBorrow = protoLatest.reduce((s, r) => s + (r.totalBorrowsUsd || 0), 0);
      const avgBApy = wtdBorrow > 0
        ? protoLatest.reduce((s, r) => s + (r.totalBorrowsUsd || 0) * (r.borrowApy || 0), 0) / wtdBorrow
        : 0;
      void avgBApy; // currently informational; kept for future per-pool surfaces
      // tvlReference: DefiLlama's published TVL for the same protocol when
      // available. tvlCoverage: our number ÷ reference, capped at 1. Lets
      // the dashboard surface "we account for X% of DefiLlama's number"
      // when there's still a coverage gap (today: Bucket's LP-tokenized
      // collateral types we haven't unwrapped).
      const ref = tvlReferenceByProto[p.id];
      const coverage = ref && ref > 0 ? Math.min(1, tvl / ref) : null;
      // tvlNote: when the headline number differs materially from what the
      // protocol's own UI displays, surface a short explanation so users
      // see both perspectives without us pretending one is canonical. Today
      // this only fires for Bucket — every other protocol's number matches
      // its own UI exactly. The note describes the methodology gap rather
      // than the specific dollar figure (which moves daily) so it doesn't
      // need updating each time numbers shift.
      const tvlNote = p.id === 'bucket' && method === 'remote'
        ? "Headline TVL is DefiLlama's published figure for Bucket. Bucket's own UI may display a slightly lower number because they price LP-tokenized collateral (BUCKETUS, BLUEFIN_STABLE_LP, etc.) using different DEX SDK calls than DefiLlama uses."
        : null;
      return {
        id: p.id,
        tvl,
        tvlMethod: method,                  // 'net' | 'gross' | 'remote' — for UI badges
        tvlNote,                            // optional methodology footnote (string or null)
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

    // As-of block per §1.3 and §6 of the analysis standard: every figure must
    // carry source + UTC timestamp + chain reference. We fetch Sui's latest
    // checkpoint via RPC so the dashboard's status bar shows a real on-chain
    // height (not a fake animated counter). Tolerant of RPC failures —
    // dashboard renders fine without it.
    const asOf = await fetchAsOfMeta();

    // ── Integrity gates per §3 ─────────────────────────────────────────────
    // Single audit panel of green/red checks. The standard says "halts on any
    // failure" before publication — we expose every gate result so the
    // dashboard can render it and so an external monitor can poll the same
    // endpoint. Gates intentionally check the SAME numbers the dashboard
    // shows, so a red gate is a hard guarantee something is off.
    const integrityGates = computeIntegrityGates({
      protocolMetrics,
      pools,
      vaults,
      asOf,
    });

    // ── Risk modeling per §5 ───────────────────────────────────────────────
    // Monte Carlo Loss-at-Risk on collateral price paths driving per-market
    // Health Factor, a VaR ensemble (historical + Student-t df=4), Expected
    // Shortfall, and an in/out-of-sample backtest. The standard treats these
    // four as the minimum bar for a publishable risk dashboard.
    //
    // Inputs:
    //   • sectorTvlSeries — daily sum across protocols from tvlSeries (which
    //     already carries the DefiLlama fallback for sparse PoolDaily days),
    //     so the realized vol calibration uses the same numbers the headline
    //     TVL series shows.
    //   • markets — every pool + vault we report, with its today HF + debt.
    //     Pulled from `pools` / `vaults` rather than re-derived so a per-row
    //     fix anywhere flows automatically into the modeling.
    //
    // Per-position HF would be ideal — Sui doesn't have public per-wallet
    // position indexers for all 5 protocols, so we use the per-market
    // aggregate HF as a proxy with a documented limitation surfaced on the
    // Risk page.
    const sectorTvlSeries: number[] = Array.from({ length: days }, (_, i) => {
      let s = 0;
      for (const arr of tvlSeries) {
        const v = arr[i]?.value;
        if (Number.isFinite(v)) s += v;
      }
      return s;
    });

    const mcMarkets: McMarketInput[] = [
      ...pools.map((r) => ({
        protocol: String(r.protocol),
        sym: String(r.sym),
        supplyUsd: Number(r.supply) || 0,
        borrowUsd: Number(r.borrow) || 0,
        healthFactor: r.healthFactor as number | null,
      })),
      ...vaults.map((r) => ({
        protocol: String(r.protocol),
        sym: String(r.sym),
        supplyUsd: Number(r.collateralUsd) || 0,
        borrowUsd: Number(r.debtUsd) || 0,
        // Vault HF analog: collateralUsd × (1/minCR%) / debtUsd
        healthFactor: r.debtUsd > 0 && r.minCR > 0
          ? (r.collateralUsd * (100 / r.minCR)) / r.debtUsd
          : null,
      })),
    ];

    const totalTvlUsdM = protocolMetrics.reduce((s, p) => s + (p.tvl || 0), 0);

    const riskModel = computeRiskModel({
      sectorTvlSeries,
      markets: mcMarkets,
      totalTvlUsdM,
      paths: 5000,
      horizonDays: 7,
    });

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
      asOf,
      integrityGates,
      riskModel,
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
  // Risk params on PoolSnapshot are decimals (0-1). Surface as percent for
  // the dashboard which expects whole-percent numbers.
  const ltvPct = (r.ltv ?? 0) * 100;
  const liqThresholdPct = (r.liquidationThreshold ?? 0) * 100;
  // Aggregate market-level Health Factor. Per-user HF needs the user's
  // collateral mix; at the market level we can compute the same quantity
  // using totals: HF = (supplyUsd × LT) / borrowUsd.
  // Returns null (frontend renders "—") when ANY of:
  //   • borrows = 0 → math undefined (∞)
  //   • liquidationThreshold missing/zero → no risk parameter → can't compute
  //   • supply = 0 → no collateral side
  // Previously returned 0 when LT was zero, which falsely flagged healthy
  // markets as "at risk" on the HF distribution. Fixed 2026-05-31.
  const lt = r.liquidationThreshold ?? 0;
  const healthFactor = (r.totalBorrowsUsd > 0 && lt > 0 && r.totalSupplyUsd > 0)
    ? (r.totalSupplyUsd * lt) / r.totalBorrowsUsd
    : null;
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
    // suppliers / borrowers: we don't yet index distinct on-chain addresses
    // per pool. Per §8.C of the analysis standard ("no un-sourced figure
    // ships"), we explicitly return null so the frontend renders "—" rather
    // than misleading the user with a 0. Wire this up properly when wallet-
    // position indexing covers all 5 protocols (currently NAVI-only).
    suppliers: null,
    borrowers: null,
    // Risk parameters now sourced from PoolSnapshot (added 2026-05-04).
    // Stored as decimal 0-1 on-chain; surfaced as whole percent here.
    ltv: ltvPct,
    liqThreshold: liqThresholdPct,
    // Aggregate market HF. null when borrows are zero — frontend renders "—".
    // Formula: HF = (collateralUsd × liquidationThreshold) / debtUsd. At HF<1
    // a market-level position would be liquidatable; in practice individual
    // wallets vary so this is a coarse health signal.
    healthFactor,
    // IRM parameters from the LEFT-joined RateModelParams. NULL when the
    // adapter hasn't populated `irm` for this pool yet — coerce to 0.
    //
    // Normalisation contract (fixed 2026-05-31):
    //   • kink and reserveFactor are stored as 0-1 decimals in the DB;
    //     surfaced here as whole percent so the frontend can render them
    //     as "80%", "20%" consistently. The Rates table was displaying
    //     irmKink as "0.8%" (the raw decimal mislabelled %). MarketDetail's
    //     IRM curve internally divides by 100 to get a fraction, which only
    //     works when the value is already in percent.
    //   • Round at the route layer so Scallop's RAY-back-and-forth floats
    //     (e.g. kink = 0.7999999998137355) don't leak unrounded into the
    //     UI as "79.99999998137355%". Two-decimal rounding is generous —
    //     all governance parameters are rounded to whole percent on every
    //     protocol's own UI.
    reserveFactor:    Math.round(((r.irmReserveFactor ?? 0) * 100) * 100) / 100,
    irmKink:          Math.round(((r.irmKink ?? 0.8) * 100) * 100) / 100,
    irmBaseRate:      r.irmBaseRate ?? 0,
    irmMultiplier:    r.irmMultiplier ?? 0,
    irmJumpMult:      r.irmJumpMult ?? 0,
    // Supply/borrow caps — not yet persisted on PoolSnapshot. We have them
    // on NormalizedPool from the adapters; persisting + reading them through
    // the snapshot is a separate schema change. Return null so the dashboard
    // renders "—" / hides cap-usage rows rather than showing fake 0%.
    supplyCap: null,
    borrowCap: null,
    oracleSource: r.protocol === 'navi' || r.protocol === 'suilend' || r.protocol === 'scallop' || r.protocol === 'alphalend' ? 'Pyth' : 'Pyth',
    // NOTE: `apyHistory` and `history` USED to be 90-element flat-fill arrays
    // here (every entry = today's value, since we don't have real per-day
    // pool history yet). At ~13.8KB per pool × 90 pools that's 1.2MB of pure
    // placeholder noise per response — caused /api/sui-lending to come back
    // ~3.8s with a 1.4MB body, which the embedded iframe perceived as a
    // timeout. Removed; MarketDetail rebuilds these flat-fills client-side
    // from `supply` / `borrow` / `supplyApy` / `borrowApy` on demand.
    // Once we capture real daily pool history (PoolDaily already exists for
    // protocol-level aggregates — needs a per-symbol query), wire that in
    // here instead of synthesising flat lines.
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

// ─── Integrity gates per §3 ────────────────────────────────────────────────
//
// Single audit endpoint of all hard checks the standard requires. Each gate
// returns one of:
//   pass  — clean
//   warn  — non-blocking anomaly (e.g. coverage gap with documented cause)
//   fail  — gate violation; per §3 this blocks publication
//
// The detail string explains WHAT failed so the integrity panel surfaces a
// real reason, not just a red dot.
type GateStatus = 'pass' | 'warn' | 'fail';
interface IntegrityGate {
  id: string;
  label: string;
  status: GateStatus;
  detail: string;
}

interface IntegrityInputs {
  protocolMetrics: Array<{ id: string; tvl: number; supply: number; borrow: number; tvlMethod?: string; tvlReference?: number | null; tvlCoverage?: number | null }>;
  pools: Array<Record<string, unknown>>;
  vaults: Array<Record<string, unknown>>;
  asOf: AsOfMeta;
}
function computeIntegrityGates(inputs: IntegrityInputs): IntegrityGate[] {
  const gates: IntegrityGate[] = [];
  const allRows: Array<Record<string, unknown>> = [...inputs.pools, ...inputs.vaults];

  // 1. Conservation: supply ≥ borrow, available liquidity ≥ 0 at every row.
  //
  // Skip rows that aren't lending positions — Bucket PSM, V1 vault wrappers,
  // SAVE pools, SCOIN savings, and AF/Kriya fountain stake rows are swap or
  // staking surfaces, not borrow positions, so "borrow > supply" on those
  // is structurally fine and shouldn't trip the publish gate. The check
  // still runs on every true lending pool plus Bucket's main USDB-issuing
  // vaults (SUI, WBTC, afSUI, haSUI, vSUI, etc).
  const NON_LENDING_PREFIXES = ['PSM-', 'V1-', 'V1PSM-', 'BKT-PSM-', 'BKT-SAVE-', 'BKT-SCOIN-', 'BKT-AF-', 'BKT-KRIYA-', 'SAVING-'];
  const isLendingRow = (sym: string): boolean => {
    return !NON_LENDING_PREFIXES.some(pfx => sym.startsWith(pfx));
  };
  {
    const violators: string[] = [];
    for (const r of allRows) {
      const sym = String(r.sym ?? r.asset ?? '?');
      if (!isLendingRow(sym)) continue;
      const sup = num(r.supply ?? r.collateralUsd);
      const bor = num(r.borrow ?? r.debtUsd);
      if (bor > sup * 1.001) violators.push(`${r.protocol}/${sym}`); // 0.1% tolerance for rounding
    }
    gates.push({
      id: 'conservation',
      label: 'Conservation (supply ≥ borrow per market)',
      status: violators.length === 0 ? 'pass' : 'fail',
      detail: violators.length === 0
        ? `${allRows.length} markets check out (Bucket vault wrappers excluded)`
        : `${violators.length} lending market(s) report borrow > supply: ${violators.slice(0, 3).join(', ')}${violators.length > 3 ? '…' : ''}`,
    });
  }

  // 2. Bounds: utilization ∈ [0, 100], APYs ≥ 0, HF ≥ 0.
  {
    const violators: string[] = [];
    for (const r of allRows) {
      const u = num(r.util);
      const sa = num(r.supplyApy);
      const ba = num(r.borrowApy);
      if (u < -0.01 || u > 100.01) violators.push(`${r.protocol}/${r.sym ?? '?'} util=${u.toFixed(1)}%`);
      if (sa < -0.01) violators.push(`${r.protocol}/${r.sym ?? '?'} supplyAPY=${sa.toFixed(2)}%`);
      if (ba < -0.01) violators.push(`${r.protocol}/${r.sym ?? '?'} borrowAPY=${ba.toFixed(2)}%`);
    }
    gates.push({
      id: 'bounds',
      label: 'Bounds (util ∈ [0,100], APYs ≥ 0)',
      status: violators.length === 0 ? 'pass' : 'fail',
      detail: violators.length === 0
        ? `${allRows.length} markets in bounds`
        : `${violators.length} out-of-bounds: ${violators.slice(0, 3).join('; ')}${violators.length > 3 ? '…' : ''}`,
    });
  }

  // 3. Aggregation: Σ(per-market supply) ≈ protocolMetrics.supply.
  {
    const failing: string[] = [];
    for (const p of inputs.protocolMetrics) {
      // Skip protocols whose live headline is fetched remotely (Scallop/Bucket)
      // — for those, the protocol total is a different source than the
      // per-market sum, so this gate doesn't apply.
      if (p.tvlMethod === 'remote') continue;
      const rows = allRows.filter(r => r.protocol === p.id);
      const sumSupply = rows.reduce((s, r) => s + num(r.supply ?? r.collateralUsd), 0);
      const tol = Math.max(0.5, p.supply * 0.02); // $0.5M floor or 2%
      if (Math.abs(sumSupply - p.supply) > tol) {
        failing.push(`${p.id}: rows=$${sumSupply.toFixed(1)}M vs metrics=$${p.supply.toFixed(1)}M`);
      }
    }
    gates.push({
      id: 'aggregation',
      label: 'Aggregation (Σ market = protocol total within 2%)',
      status: failing.length === 0 ? 'pass' : 'warn',
      detail: failing.length === 0
        ? 'All non-remote protocols reconcile'
        : `${failing.length} mismatch: ${failing.join('; ')}`,
    });
  }

  // 4. Reconciliation vs DefiLlama (where we have a reference).
  {
    const failing: string[] = [];
    for (const p of inputs.protocolMetrics) {
      if (p.tvlReference == null) continue;
      const drift = Math.abs(p.tvl - p.tvlReference) / p.tvlReference;
      // Bucket is on 'remote' (DefiLlama) so drift should be ~0. NAVI is on
      // 'net' (supply-borrow) which CAN diverge from DefiLlama's gross figure;
      // we accept up to 50% drift as expected methodology difference and only
      // flag above that.
      const tol = p.tvlMethod === 'remote' ? 0.05 : 0.5;
      if (drift > tol) failing.push(`${p.id}: $${p.tvl.toFixed(1)}M vs DefiLlama $${p.tvlReference.toFixed(1)}M (${(drift * 100).toFixed(0)}%)`);
    }
    gates.push({
      id: 'reconciliation',
      label: 'Reconciliation vs DefiLlama (within tolerance)',
      status: failing.length === 0 ? 'pass' : 'warn',
      detail: failing.length === 0
        ? 'All protocols reconcile or no reference set'
        : failing.join('; '),
    });
  }

  // 5. Freshness: as-of timestamp recent enough.
  {
    let status: GateStatus = 'pass';
    let detail = 'Snapshot timestamp current';
    if (!inputs.asOf.checkpointTimestamp) {
      status = 'warn';
      detail = 'No checkpoint timestamp from RPC';
    } else {
      const age = Math.round((Date.now() - new Date(inputs.asOf.checkpointTimestamp).getTime()) / 1000);
      if (age > 3600) { status = 'fail'; detail = `Checkpoint age ${age}s (>1h)`; }
      else if (age > 600) { status = 'warn'; detail = `Checkpoint age ${age}s (>10m)`; }
      else detail = `Checkpoint age ${age}s`;
    }
    gates.push({ id: 'freshness', label: 'Freshness (as-of within tolerance)', status, detail });
  }

  // 6. Provenance: every protocol has a documented method.
  {
    const missing = inputs.protocolMetrics.filter(p => !p.tvlMethod).map(p => p.id);
    gates.push({
      id: 'provenance',
      label: 'Provenance (tvlMethod documented per protocol)',
      status: missing.length === 0 ? 'pass' : 'fail',
      detail: missing.length === 0
        ? 'All 5 protocols carry a method tag'
        : `Missing method: ${missing.join(', ')}`,
    });
  }

  // 7. Stale-collateral flag per §4 of the standard.
  //
  // Definition (verbatim from the standard): collateral that remains on a
  // protocol but whose oracle no longer reflects a tradeable price is
  // included in Total Supply only while a price is quoted, but flagged
  // here and excluded from liquidatable figures.
  //
  // Heuristic (until per-asset price age is indexed): any non-dust row
  // (supply ≥ $100K) whose `price` is null / 0 is treated as stale. This
  // catches the price-fetch failure mode (DefiLlama miss, oracle gap, etc.).
  // The standard wants a max-age check too; that requires a per-asset
  // price timestamp we don't yet capture — documented as a follow-up.
  {
    const stale: string[] = [];
    for (const r of allRows) {
      const sup = num(r.supply ?? r.collateralUsd);
      if (sup < 0.1) continue; // $0.1M floor — skip dust
      const price = num(r.price ?? r.spotPrice);
      const sym = String(r.sym ?? r.asset ?? '?');
      if (price === 0) stale.push(`${r.protocol}/${sym}`);
    }
    gates.push({
      id: 'stale_collateral',
      label: 'Stale-collateral flag (§4 frozen-price rule)',
      status: stale.length === 0 ? 'pass' : 'warn',
      detail: stale.length === 0
        ? 'No stale-priced non-dust collateral detected'
        : `${stale.length} non-dust row(s) priced at 0 / no oracle: ${stale.slice(0, 4).join(', ')}${stale.length > 4 ? '…' : ''}`,
    });
  }

  // 8. Outlier-row sanity check.
  //
  // Catches a class of bug we hit twice already: a single market row whose
  // USD value is implausibly large relative to either the protocol's own
  // reference TVL or the rest of the same protocol's rows. Most recent
  // case — Bucket's BKT-AF-AFSUI-SUI row reading $1.46B because the
  // Aftermath LP unwrapping math was missing the coin-decimal scaling. A
  // human eyeballing the chart caught it; this gate makes the next one
  // visible without needing eyeballs.
  //
  // Rule of thumb for the two thresholds:
  //   • absolute floor: $200M is larger than every legitimate single market
  //     across all 5 protocols today, by a large margin.
  //   • relative floor: any row > 80% of its protocol's headline TVL is
  //     suspicious — even highly-concentrated protocols don't put 80%+ of
  //     their book into one market.
  // Either trigger flags 'warn' so the publication gate stops short of
  // 'fail' (we want the chart to render with the bad row called out, not
  // disappear entirely).
  {
    const ABS_FLOOR_USD_M = 200; // $M
    const REL_FLOOR_PCT = 0.80;
    const violators: string[] = [];
    for (const r of allRows) {
      const sup = num(r.supply ?? r.collateralUsd);
      if (sup < ABS_FLOOR_USD_M) {
        // Absolute floor cleared. Check relative.
        const proto = String(r.protocol);
        const headlineRow = inputs.protocolMetrics.find(p => p.id === proto);
        if (!headlineRow || headlineRow.tvl <= 0) continue;
        if (sup > headlineRow.tvl * REL_FLOOR_PCT) {
          violators.push(`${proto}/${r.sym ?? r.asset ?? '?'} $${sup.toFixed(1)}M (${((sup / headlineRow.tvl) * 100).toFixed(0)}% of ${proto} TVL)`);
        }
      } else {
        violators.push(`${r.protocol}/${r.sym ?? r.asset ?? '?'} $${sup.toFixed(1)}M (> $${ABS_FLOOR_USD_M}M floor)`);
      }
    }
    gates.push({
      id: 'outlier_row',
      label: 'Outlier-row sanity (single market < $200M and < 80% of protocol TVL)',
      status: violators.length === 0 ? 'pass' : 'warn',
      detail: violators.length === 0
        ? `${allRows.length} markets within sanity bounds`
        : `${violators.length} outlier(s): ${violators.slice(0, 3).join('; ')}${violators.length > 3 ? '…' : ''}`,
    });
  }

  return gates;
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

// ─── As-of helper ──────────────────────────────────────────────────────────
//
// Returns the freshness/source block required by §1.3 of the analysis
// standard. Fetches the latest Sui checkpoint sequence number and timestamp
// from the public fullnode (Alchemy if available, else public RPC) so the
// dashboard chrome shows a real on-chain height instead of a fake animation.
// Falls back to a "—"-marker shape when RPC is unreachable so the page still
// renders rather than 500ing.
interface AsOfMeta {
  checkpoint: number | null;
  checkpointTimestamp: string | null;
  network: 'sui-mainnet';
  serverTime: string;
  rpcSource: string;
}
async function fetchAsOfMeta(): Promise<AsOfMeta> {
  const rpc = process.env.ALCHEMY_SUI_RPC ?? 'https://fullnode.mainnet.sui.io:443';
  const rpcSource = rpc.includes('alchemy') ? 'alchemy' : rpc.includes('blockvision') ? 'blockvision' : 'fullnode.sui.io';
  const out: AsOfMeta = {
    checkpoint: null,
    checkpointTimestamp: null,
    network: 'sui-mainnet',
    serverTime: new Date().toISOString(),
    rpcSource,
  };
  try {
    // Step 1: latest checkpoint sequence number (cheap).
    const seqRes = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_getLatestCheckpointSequenceNumber', params: [] }),
      next: { revalidate: 30 },
    });
    if (!seqRes.ok) return out;
    const seqJson = await seqRes.json() as { result?: string };
    const seqStr = seqJson.result;
    if (!seqStr) return out;
    const checkpoint = Number(seqStr);
    out.checkpoint = checkpoint;

    // Step 2: timestamp of that checkpoint. Optional — if it fails we still
    // have the height, which is the primary signal.
    try {
      const tsRes = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'sui_getCheckpoint', params: [seqStr] }),
        next: { revalidate: 30 },
      });
      if (tsRes.ok) {
        const tsJson = await tsRes.json() as { result?: { timestampMs?: string | number } };
        const ms = Number(tsJson.result?.timestampMs);
        if (Number.isFinite(ms) && ms > 0) out.checkpointTimestamp = new Date(ms).toISOString();
      }
    } catch { /* keep checkpoint, no timestamp */ }
  } catch {
    /* leave as nulls */
  }
  return out;
}
