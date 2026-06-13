import { getDb } from '@/lib/db';
(async () => {
  const db = getDb(); if (!db) throw new Error('no db');
  const rows = (await db.$queryRawUnsafe(`
    SELECT protocol, MAX(date) AS last, COUNT(*)::int AS rows
    FROM "DefillamaTvl"
    WHERE date >= '2026-05-01'::date
    GROUP BY protocol ORDER BY protocol
  `)) as any[];
  console.log('Protocol      Last day    Rows since May 1');
  for (const r of rows) console.log('  ' + r.protocol.padEnd(10) + r.last.toISOString().slice(0,10) + '    ' + r.rows);
  await db.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
