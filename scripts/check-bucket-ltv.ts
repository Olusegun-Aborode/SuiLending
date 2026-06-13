import { getDb } from '@/lib/db';
(async () => {
  const db = getDb(); if (!db) throw new Error('no db');
  // What does the route actually read for bucket ltv? COALESCE(rmp, ps)
  console.log('=== Bucket: RateModelParams.ltv vs PoolSnapshot.ltv (raw stored values) ===');
  const rows = (await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (ps.symbol)
      ps.symbol,
      ps.ltv::float8 AS ps_ltv,
      ps."liquidationThreshold"::float8 AS ps_lt,
      rmp.ltv::float8 AS rmp_ltv,
      rmp."liquidationThreshold"::float8 AS rmp_lt,
      COALESCE(NULLIF(rmp.ltv::float8,0), ps.ltv::float8) AS effective_ltv
    FROM "PoolSnapshot" ps
    LEFT JOIN "RateModelParams" rmp ON rmp.protocol=ps.protocol AND rmp.symbol=ps.symbol
    WHERE ps.protocol = 'bucket' AND ps.timestamp >= NOW() - INTERVAL '7 days'
      AND ps."totalBorrowsUsd" > 1
    ORDER BY ps.symbol, ps.timestamp DESC
    LIMIT 15
  `)) as any[];
  console.log('symbol                  ps_ltv    ps_lt    rmp_ltv  rmp_lt   effective_ltv');
  for (const r of rows) {
    console.log(`  ${r.symbol.padEnd(22)} ${String(r.ps_ltv).padStart(7)}  ${String(r.ps_lt).padStart(7)}  ${String(r.rmp_ltv).padStart(7)}  ${String(r.rmp_lt).padStart(6)}  ${r.effective_ltv}`);
  }
  await db.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
