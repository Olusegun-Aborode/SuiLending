import { getDb } from '@/lib/db';
(async () => {
  const db = getDb(); if (!db) return;

  console.log('═══ DATA COVERAGE AUDIT — MAY 2026 ═══\n');

  console.log('1. PoolDaily (per-protocol per-day aggregates)');
  const pd = await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(DISTINCT date)::int AS days,
           MIN(date) AS first, MAX(date) AS last,
           COUNT(DISTINCT symbol)::int AS markets
    FROM "PoolDaily"
    WHERE date >= '2026-05-01'::date AND date <= '2026-05-31'::date
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol    days  first       last        markets');
  for (const r of pd) {
    console.log(`   ${r.protocol.padEnd(10)} ${String(r.days).padStart(4)}  ${r.first.toISOString().slice(0,10)}  ${r.last.toISOString().slice(0,10)}  ${r.markets}`);
  }
  console.log('   ─ target: 31 days\n');

  console.log('2. DefillamaTvl (daily protocol TVL, gap-fill source)');
  const dl = await db.$queryRawUnsafe(`
    SELECT protocol, COUNT(*)::int AS days,
           MIN(date) AS first, MAX(date) AS last,
           AVG("tvlUsd")::float8 AS avg_tvl
    FROM "DefillamaTvl"
    WHERE date >= '2026-05-01'::date AND date <= '2026-05-31'::date
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol    days  first       last        avg_TVL');
  for (const r of dl) {
    console.log(`   ${r.protocol.padEnd(10)} ${String(r.days).padStart(4)}  ${r.first.toISOString().slice(0,10)}  ${r.last.toISOString().slice(0,10)}  $${(r.avg_tvl/1e6).toFixed(2)}M`);
  }
  console.log();

  console.log('3. LiquidationEvent — May 2026 (real value events)');
  const liq = await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::int AS real_events,
           SUM("debtUsd") FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::float8 AS total_debt,
           SUM("collateralUsd") FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::float8 AS total_collat,
           MIN(timestamp) AS first, MAX(timestamp) AS last,
           COUNT(DISTINCT borrower)::int AS borrowers,
           COUNT(DISTINCT liquidator)::int AS liquidators
    FROM "LiquidationEvent"
    WHERE timestamp >= '2026-05-01'::timestamp AND timestamp < '2026-06-01'::timestamp
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol    total   real    debt$M     coll$M     range            borrowers  liqs');
  let grand = 0, grandDebt = 0;
  for (const r of liq) {
    grand += r.real_events; grandDebt += r.total_debt || 0;
    console.log(`   ${r.protocol.padEnd(10)} ${String(r.total).padStart(5)}  ${String(r.real_events).padStart(5)}  ${((r.total_debt||0)/1e6).toFixed(2).padStart(7)}M  ${((r.total_collat||0)/1e6).toFixed(2).padStart(7)}M  ${r.first.toISOString().slice(5,10)}→${r.last.toISOString().slice(5,10)}    ${String(r.borrowers).padStart(8)}  ${r.liquidators}`);
  }
  console.log(`   TOTAL                  ${grand}  ${(grandDebt/1e6).toFixed(2)}M\n`);

  console.log('4. RateModelParams (risk + IRM, current state)');
  const rmp = await db.$queryRawUnsafe(`
    SELECT protocol, COUNT(*)::int AS rows,
           COUNT(*) FILTER (WHERE ltv > 0)::int AS w_ltv,
           COUNT(*) FILTER (WHERE "liquidationThreshold" > 0)::int AS w_lt,
           COUNT(*) FILTER (WHERE "reserveFactor" > 0)::int AS w_rf,
           COUNT(*) FILTER (WHERE kink > 0)::int AS w_kink
    FROM "RateModelParams"
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol    rows  ltv>0  lt>0  rf>0  kink>0');
  for (const r of rmp) {
    console.log(`   ${r.protocol.padEnd(10)} ${String(r.rows).padStart(4)}  ${String(r.w_ltv).padStart(5)}  ${String(r.w_lt).padStart(4)}  ${String(r.w_rf).padStart(4)}  ${String(r.w_kink).padStart(6)}`);
  }
  console.log();

  console.log('5. Per-symbol PoolDaily — asset-level history');
  const psd = await db.$queryRawUnsafe(`
    SELECT protocol, COUNT(DISTINCT symbol)::int AS syms,
           AVG(per_sym_days)::float8 AS avg_days,
           MIN(per_sym_days)::int AS min_days,
           MAX(per_sym_days)::int AS max_days
    FROM (
      SELECT protocol, symbol, COUNT(DISTINCT date)::int AS per_sym_days
      FROM "PoolDaily"
      WHERE date >= '2026-05-01'::date AND date <= '2026-05-31'::date
      GROUP BY protocol, symbol
    ) t GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol    syms  avg_days  min_days  max_days');
  for (const r of psd) {
    console.log(`   ${r.protocol.padEnd(10)} ${String(r.syms).padStart(4)}  ${r.avg_days.toFixed(1).padStart(7)}  ${String(r.min_days).padStart(7)}  ${r.max_days}`);
  }
  console.log();

  console.log('6. Liquidations by week (May 2026)');
  const wk = await db.$queryRawUnsafe(`
    SELECT date_trunc('week', timestamp) AS wk,
           COUNT(*) FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::int AS events,
           SUM("debtUsd") FILTER (WHERE "debtUsd" >= 1)::float8 AS debt
    FROM "LiquidationEvent"
    WHERE timestamp >= '2026-05-01'::timestamp AND timestamp < '2026-06-01'::timestamp
    GROUP BY 1 ORDER BY 1
  `) as any[];
  for (const r of wk) {
    console.log(`   ${r.wk.toISOString().slice(0,10)} (week)  ${r.events} events  $${(r.debt/1e6).toFixed(3)}M repaid`);
  }
  console.log();

  console.log('7. TVL trajectory — May 1 → May 31 (DefillamaTvl, per protocol)');
  for (const proto of ['navi','suilend','scallop','alphalend','bucket']) {
    const t = await db.$queryRawUnsafe(`
      SELECT date, "tvlUsd"::float8 AS tvl FROM "DefillamaTvl"
      WHERE protocol = $1 AND date IN ('2026-05-01'::date, '2026-05-15'::date, '2026-05-31'::date)
      ORDER BY date
    `, proto) as any[];
    if (t.length >= 2) {
      const first = t[0], last = t[t.length-1];
      const ch = ((last.tvl - first.tvl) / first.tvl * 100);
      console.log(`   ${proto.padEnd(10)} May 01: $${(first.tvl/1e6).toFixed(1)}M → May 31: $${(last.tvl/1e6).toFixed(1)}M  (${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%)`);
    } else {
      console.log(`   ${proto.padEnd(10)} insufficient endpoint data`);
    }
  }

  await db.$disconnect();
})().catch(e => console.error(e));
