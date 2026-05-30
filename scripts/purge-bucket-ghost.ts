// One-shot cleanup: delete the BKT-AF-AFSUI-SUI PoolSnapshot + PoolDaily
// rows that carry the pre-fix $1.46B ghost values. The fixed adapter will
// repopulate them with sane (~$5-low-USD) numbers on the next cron run.
import { getDb } from '@/lib/db';

async function main() {
  const db = getDb();
  if (!db) throw new Error('no db');

  const SYMBOL = 'BKT-AF-AFSUI-SUI';
  const SUS_THRESHOLD_USD = 100_000_000; // $100M floor — real vault is ~$5

  const ps = await db.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n, MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts,
           MAX("totalSupplyUsd")::float8 AS max_usd
    FROM "PoolSnapshot"
    WHERE protocol = 'bucket' AND symbol = $1 AND "totalSupplyUsd" >= $2
  `, SYMBOL, SUS_THRESHOLD_USD) as any[];
  console.log('PoolSnapshot ghost rows:', ps[0]);

  const pd = await db.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n, MIN(date) AS min_d, MAX(date) AS max_d,
           MAX("closeTotalSupplyUsd")::float8 AS max_usd
    FROM "PoolDaily"
    WHERE protocol = 'bucket' AND symbol = $1 AND "closeTotalSupplyUsd" >= $2
  `, SYMBOL, SUS_THRESHOLD_USD) as any[];
  console.log('PoolDaily   ghost rows:', pd[0]);

  // Delete.
  const dPs = await db.$executeRawUnsafe(`
    DELETE FROM "PoolSnapshot"
    WHERE protocol = 'bucket' AND symbol = $1 AND "totalSupplyUsd" >= $2
  `, SYMBOL, SUS_THRESHOLD_USD);
  const dPd = await db.$executeRawUnsafe(`
    DELETE FROM "PoolDaily"
    WHERE protocol = 'bucket' AND symbol = $1 AND "closeTotalSupplyUsd" >= $2
  `, SYMBOL, SUS_THRESHOLD_USD);
  console.log(`deleted ${dPs} PoolSnapshot row(s), ${dPd} PoolDaily row(s)`);

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
