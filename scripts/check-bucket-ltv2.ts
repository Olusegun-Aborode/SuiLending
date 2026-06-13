import { getDb } from '@/lib/db';
(async () => {
  const db = getDb(); if (!db) throw new Error('no db');
  // All bucket vaults with debt, raw ltv + what 10000/ltv and 100/ltv give
  const rows = (await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (symbol) symbol,
      ltv::float8 AS ltv,
      "totalBorrowsUsd"::float8 AS debt
    FROM "PoolSnapshot"
    WHERE protocol = 'bucket' AND timestamp >= NOW() - INTERVAL '7 days'
    ORDER BY symbol, timestamp DESC
  `)) as any[];
  console.log('symbol                      ltv_raw     debt$      100/ltv   10000/ltv   plausible minCR?');
  for (const r of rows) {
    if ((r.debt || 0) < 1 && r.ltv === 0) continue; // skip empty non-CDP
    const a = r.ltv > 0 ? (100/r.ltv).toFixed(1) : '—';
    const b = r.ltv > 0 ? (10000/r.ltv).toFixed(1) : '—';
    console.log(`  ${r.symbol.padEnd(26)} ${String(r.ltv).slice(0,9).padStart(9)}  ${(r.debt||0).toFixed(0).padStart(8)}   ${a.padStart(7)}   ${b.padStart(8)}`);
  }
  await db.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
