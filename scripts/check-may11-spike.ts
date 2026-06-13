import { getDb } from '@/lib/db';
(async () => {
  const db = getDb(); if (!db) throw new Error('no db');
  // Daily sector TVL May 1 → May 31, and per-protocol around May 8-14
  console.log('Daily sector TVL May 1-31:');
  const daily = (await db.$queryRawUnsafe(`
    SELECT date, SUM("tvlUsd")::float8 AS tvl
    FROM "DefillamaTvl"
    WHERE date >= '2026-05-01'::date AND date <= '2026-05-31'::date
    GROUP BY date ORDER BY date
  `)) as any[];
  let prev = 0;
  for (const r of daily) {
    const ch = prev > 0 ? `(${((r.tvl-prev)/prev*100).toFixed(2)}%)` : '';
    console.log(`  ${r.date.toISOString().slice(0,10)}  $${(r.tvl/1e6).toFixed(2)}M  ${ch}`);
    prev = r.tvl;
  }
  console.log('\nPer-protocol around May 8-14:');
  const wk = (await db.$queryRawUnsafe(`
    SELECT date, protocol, "tvlUsd"::float8 AS tvl
    FROM "DefillamaTvl"
    WHERE date >= '2026-05-08'::date AND date <= '2026-05-14'::date
    ORDER BY date, protocol
  `)) as any[];
  let lastDate = '';
  for (const r of wk) {
    const d = r.date.toISOString().slice(0,10);
    if (d !== lastDate) { console.log(); lastDate = d; }
    console.log(`  ${d}  ${r.protocol.padEnd(10)} $${(r.tvl/1e6).toFixed(2)}M`);
  }
  await db.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
