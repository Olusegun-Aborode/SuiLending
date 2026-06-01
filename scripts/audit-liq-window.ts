import { getDb } from '@/lib/db';
(async () => {
  const db = getDb(); if (!db) return;
  const rows = await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(*)::int AS events,
           COUNT(*) FILTER (WHERE "debtUsd" < 1 AND "collateralUsd" < 1)::int AS subdollar,
           MIN(timestamp) AS first,
           MAX(timestamp) AS last
    FROM "LiquidationEvent"
    WHERE timestamp >= NOW() - INTERVAL '30 days'
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('protocol     events  sub-$1  first              last               span');
  let totalEvents = 0;
  for (const r of rows) {
    const d = (new Date(r.last).getTime() - new Date(r.first).getTime()) / 86400000;
    totalEvents += r.events;
    console.log(`  ${r.protocol.padEnd(10)} ${String(r.events).padStart(5)}  ${String(r.subdollar).padStart(5)}   ${new Date(r.first).toISOString().slice(0,16)}  ${new Date(r.last).toISOString().slice(0,16)}  ${d.toFixed(0)}d`);
  }
  console.log(`  TOTAL      ${totalEvents}`);
  await db.$disconnect();
})().catch(e => console.error(e));
