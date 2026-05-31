import { getDb } from '@/lib/db';
async function main() {
  const db = getDb();
  if (!db) throw new Error('no db');
  // All NAVI snapshots in last 48h with ltv breakdown
  const rows = await db.$queryRawUnsafe(`
    SELECT timestamp, symbol,
           ltv::float8 AS ltv,
           "liquidationThreshold"::float8 AS lt
    FROM "PoolSnapshot"
    WHERE protocol = 'navi' AND timestamp >= NOW() - INTERVAL '48 hours'
    ORDER BY timestamp DESC, symbol
    LIMIT 80
  `) as any[];
  // Group by timestamp
  const byTs = new Map<string, any[]>();
  for (const r of rows) {
    const k = r.timestamp.toISOString().slice(0, 19);
    if (!byTs.has(k)) byTs.set(k, []);
    byTs.get(k)!.push(r);
  }
  console.log('NAVI snapshots in last 48h, grouped by timestamp:');
  for (const [ts, syms] of byTs) {
    const withLtv = syms.filter(s => s.ltv > 0).length;
    const withLt = syms.filter(s => s.lt > 0).length;
    console.log(`  ${ts}  ${syms.length} symbols · ${withLtv} with ltv · ${withLt} with lt`);
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
