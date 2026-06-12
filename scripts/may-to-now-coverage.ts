import { getDb } from '@/lib/db';
(async () => {
  const db = getDb(); if (!db) return;

  const START = '2026-05-01';
  console.log(`═══ COVERAGE FROM ${START} → NOW (today: ${new Date().toISOString().slice(0,10)}) ═══\n`);
  const today = new Date();
  const dayMs = 86400 * 1000;
  const expectedDays = Math.floor((today.getTime() - new Date(START).getTime()) / dayMs) + 1;
  console.log(`Expected calendar days: ${expectedDays}\n`);

  // 1. DefillamaTvl — the chart's primary source for protocol-level daily TVL
  console.log('1. DefillamaTvl (powers the TVL by Protocol chart and Daily Flows)');
  const dl = await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(DISTINCT date)::int AS days,
           MIN(date) AS first, MAX(date) AS last
    FROM "DefillamaTvl"
    WHERE date >= '2026-05-01'::date
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol     days  first        last         (target ' + expectedDays + ')');
  for (const r of dl) {
    const gap = expectedDays - r.days;
    const flag = gap > 2 ? `  GAP: ${gap}d behind` : '  ✓';
    console.log(`   ${r.protocol.padEnd(10)} ${String(r.days).padStart(4)}  ${r.first.toISOString().slice(0,10)}   ${r.last.toISOString().slice(0,10)}${flag}`);
  }
  console.log();

  // 2. PoolDaily — the per-symbol asset-level history
  console.log('2. PoolDaily — protocol totals (one row per symbol per day)');
  const pd = await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(DISTINCT date)::int AS days,
           MIN(date) AS first, MAX(date) AS last,
           COUNT(DISTINCT symbol)::int AS markets
    FROM "PoolDaily"
    WHERE date >= '2026-05-01'::date
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol     days  first        last         markets');
  for (const r of pd) {
    const flag = (expectedDays - r.days) > 2 ? `  GAP: ${expectedDays - r.days}d behind` : '  ✓';
    console.log(`   ${r.protocol.padEnd(10)} ${String(r.days).padStart(4)}  ${r.first.toISOString().slice(0,10)}   ${r.last.toISOString().slice(0,10)}   ${r.markets}${flag}`);
  }
  console.log();

  // 3. LiquidationEvent (only filters real events)
  console.log('3. LiquidationEvent (real value events, debt+coll >= $1)');
  const liq = await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(*) FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::int AS events,
           MIN(timestamp) AS first, MAX(timestamp) AS last,
           EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 86400.0 AS span_days
    FROM "LiquidationEvent"
    WHERE timestamp >= '2026-05-01'::timestamp
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol     events   first             last              span_days');
  let totalLiq = 0;
  for (const r of liq) {
    totalLiq += r.events;
    console.log(`   ${r.protocol.padEnd(10)} ${String(r.events).padStart(6)}    ${r.first.toISOString().slice(5,16)}   ${r.last.toISOString().slice(5,16)}   ${r.span_days.toFixed(1)}d`);
  }
  console.log(`   TOTAL                  ${totalLiq}`);
  console.log();

  // 4. PoolSnapshot density (recent-state freshness)
  console.log('4. PoolSnapshot — current freshness (latest snapshot per protocol)');
  const ps = await db.$queryRawUnsafe(`
    SELECT protocol, MAX(timestamp) AS latest,
           COUNT(*)::int AS rows_since_may
    FROM "PoolSnapshot"
    WHERE timestamp >= '2026-05-01'::timestamp
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('   protocol     latest snapshot      rows_since_may');
  for (const r of ps) {
    const ageMin = (Date.now() - new Date(r.latest).getTime()) / 60000;
    const flag = ageMin > 60 ? `  STALE: ${ageMin.toFixed(0)}min` : `  ✓ ${ageMin.toFixed(0)}min ago`;
    console.log(`   ${r.protocol.padEnd(10)} ${r.latest.toISOString().slice(0,16)}     ${String(r.rows_since_may).padStart(7)}${flag}`);
  }

  await db.$disconnect();
})().catch(e => console.error(e));
