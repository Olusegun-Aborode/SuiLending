// Repair v2: seed RateModelParams.ltv + liquidationThreshold for every
// (protocol, symbol) pair by querying the latest non-zero PoolSnapshot
// row + a one-shot NAVI fetch via fetchAllPools.
//
// Idempotent — re-running just re-applies the same upserts.
import { fetchAllPools } from '@/lib/sdk';
import { getDb } from '@/lib/db';

async function main() {
  const db = getDb();
  if (!db) throw new Error('no db');

  // For NAVI: hit the live API. fetchAllPools returns correct ltv/lt.
  const pools = await fetchAllPools();
  console.log(`NAVI: ${pools.length} pools from SDK`);
  let upserted = 0;
  for (const p of pools) {
    try {
      await db.rateModelParams.upsert({
        where: { protocol_symbol: { protocol: 'navi', symbol: p.symbol } },
        update: {
          ...(p.ltv > 0 ? { ltv: p.ltv } : {}),
          ...(p.liquidationThreshold > 0 ? { liquidationThreshold: p.liquidationThreshold } : {}),
          ...(p.irm ? {
            baseRate:       p.irm.baseRate,
            multiplier:     p.irm.multiplier,
            jumpMultiplier: p.irm.jumpMultiplier,
            kink:           p.irm.kink,
            reserveFactor:  p.irm.reserveFactor,
          } : {}),
          updatedAt: new Date(),
        },
        create: {
          protocol: 'navi',
          symbol: p.symbol,
          baseRate:       p.irm?.baseRate ?? 0,
          multiplier:     p.irm?.multiplier ?? 0,
          jumpMultiplier: p.irm?.jumpMultiplier ?? 0,
          kink:           p.irm?.kink ?? 0,
          reserveFactor:  p.irm?.reserveFactor ?? 0,
          ltv:            p.ltv,
          liquidationThreshold: p.liquidationThreshold,
        },
      });
      upserted++;
    } catch (e) {
      console.warn(`  upsert failed ${p.symbol}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`navi: ${upserted} RateModelParams upserts`);

  // For the other 4 protocols: harvest the latest non-zero ltv/lt from
  // their PoolSnapshot rows (they were ingesting correctly per the audit).
  for (const protocol of ['suilend', 'scallop', 'alphalend', 'bucket']) {
    const rows = await db.$queryRawUnsafe(`
      SELECT DISTINCT ON (symbol)
        symbol, ltv::float8 AS ltv, "liquidationThreshold"::float8 AS lt
      FROM "PoolSnapshot"
      WHERE protocol = $1 AND timestamp >= NOW() - INTERVAL '7 days'
      ORDER BY symbol, timestamp DESC
    `, protocol) as any[];
    let n = 0;
    for (const r of rows) {
      if (r.ltv === 0 && r.lt === 0) continue;
      try {
        await db.rateModelParams.upsert({
          where: { protocol_symbol: { protocol, symbol: r.symbol } },
          update: {
            ...(r.ltv > 0 ? { ltv: r.ltv } : {}),
            ...(r.lt > 0 ? { liquidationThreshold: r.lt } : {}),
            updatedAt: new Date(),
          },
          create: {
            protocol, symbol: r.symbol,
            baseRate: 0, multiplier: 0, jumpMultiplier: 0, kink: 0, reserveFactor: 0,
            ltv: r.ltv || 0, liquidationThreshold: r.lt || 0,
          },
        });
        n++;
      } catch (e) {
        // Already-existing rows may fail on the create path; the WHERE
        // clause should route to update. Swallow benign errors.
      }
    }
    console.log(`${protocol}: ${n} RateModelParams upserts from snapshots`);
  }

  // Verify
  const verify = await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(*)::int AS rows,
           COUNT(*) FILTER (WHERE ltv > 0)::int AS with_ltv,
           COUNT(*) FILTER (WHERE "liquidationThreshold" > 0)::int AS with_lt,
           COUNT(*) FILTER (WHERE "reserveFactor" > 0)::int AS with_rf
    FROM "RateModelParams"
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  console.log('\nRateModelParams coverage:');
  for (const v of verify) {
    console.log(`  ${v.protocol.padEnd(10)} rows=${v.rows}  ltv>0: ${v.with_ltv}  lt>0: ${v.with_lt}  rf>0: ${v.with_rf}`);
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
