// Repair script: NAVI's latest PoolSnapshot batch has ltv/lt/rf = 0 because
// the deployed cron wasn't writing them. RateModelParams.reserveFactor was
// also zero because the SDK hardcoded it. After SDK fix:
//   1. Refetch NAVI via fetchAllPools() — values arrive correctly populated.
//   2. UPDATE the most-recent PoolSnapshot row for each (protocol, symbol)
//      with the live ltv / liquidationThreshold.
//   3. UPSERT RateModelParams.reserveFactor with the SDK's now-correct value.
//
// Idempotent — re-running just re-applies the same UPDATE.
import { fetchAllPools } from '@/lib/sdk';
import { getDb } from '@/lib/db';

async function main() {
  const db = getDb();
  if (!db) throw new Error('no db');

  const pools = await fetchAllPools();
  console.log(`NAVI: ${pools.length} pools from SDK`);

  let updated = 0, irmUpdated = 0;
  for (const p of pools) {
    // Update the most-recent PoolSnapshot row for this (protocol, symbol)
    // pair. UPDATE … WHERE id = (SELECT … ORDER BY timestamp DESC LIMIT 1)
    // so only one row gets the new values.
    const res = await db.$executeRawUnsafe(`
      UPDATE "PoolSnapshot"
      SET ltv = $1, "liquidationThreshold" = $2
      WHERE id = (
        SELECT id FROM "PoolSnapshot"
        WHERE protocol = 'navi' AND symbol = $3
        ORDER BY timestamp DESC
        LIMIT 1
      )
    `, p.ltv ?? 0, p.liquidationThreshold ?? 0, p.symbol);
    if (res > 0) updated++;

    if (p.irm) {
      try {
        await db.rateModelParams.upsert({
          where: { protocol_symbol: { protocol: 'navi', symbol: p.symbol } },
          update: {
            baseRate:       p.irm.baseRate,
            multiplier:     p.irm.multiplier,
            jumpMultiplier: p.irm.jumpMultiplier,
            kink:           p.irm.kink,
            reserveFactor:  p.irm.reserveFactor,
            updatedAt:      new Date(),
          },
          create: {
            protocol: 'navi',
            symbol: p.symbol,
            baseRate:       p.irm.baseRate,
            multiplier:     p.irm.multiplier,
            jumpMultiplier: p.irm.jumpMultiplier,
            kink:           p.irm.kink,
            reserveFactor:  p.irm.reserveFactor,
          },
        });
        irmUpdated++;
      } catch (e) {
        console.warn(`  irm upsert failed for ${p.symbol}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log(`updated ${updated} PoolSnapshot rows, ${irmUpdated} RateModelParams rows`);

  // Verify
  const verif = await db.$queryRawUnsafe(`
    SELECT symbol,
           ltv::float8 AS ltv,
           "liquidationThreshold"::float8 AS lt
    FROM "PoolSnapshot"
    WHERE protocol = 'navi' AND timestamp >= NOW() - INTERVAL '2 hours'
    ORDER BY timestamp DESC, symbol
    LIMIT 12
  `) as any[];
  console.log('\npost-repair sample:');
  for (const r of verif) {
    console.log(`  ${r.symbol.padEnd(8)} ltv=${(r.ltv*100).toFixed(2)}%  lt=${(r.lt*100).toFixed(2)}%`);
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
