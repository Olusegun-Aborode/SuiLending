import { getDb } from '@/lib/db';
async function main() {
  const db = getDb();
  if (!db) throw new Error('no db');
  const rows = await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(*)::int                AS rows,
           MIN(timestamp)               AS first,
           MAX(timestamp)               AS last,
           COUNT(*) FILTER (WHERE ltv > 0)::int AS with_ltv,
           COUNT(*) FILTER (WHERE "liquidationThreshold" > 0)::int AS with_lt,
           MAX(timestamp) FILTER (WHERE ltv > 0) AS last_with_ltv
    FROM "PoolSnapshot"
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('protocol  rows  first→last range          with_ltv  with_lt  last_row_with_ltv');
  for (const r of rows) {
    const f = r.first.toISOString().slice(0,16);
    const l = r.last.toISOString().slice(0,16);
    const lwl = r.last_with_ltv ? r.last_with_ltv.toISOString().slice(0,16) : '—';
    console.log(`  ${r.protocol.padEnd(10)} ${String(r.rows).padStart(5)}  ${f} → ${l}   ${String(r.with_ltv).padStart(5)}   ${String(r.with_lt).padStart(5)}   ${lwl}`);
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
