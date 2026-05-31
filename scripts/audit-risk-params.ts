// Verify which protocols actually have non-zero ltv / liquidationThreshold /
// reserveFactor in the DB. The user's audit reports NAVI shows 0% across the
// board while Suilend/Scallop/AlphaLend show real values.
import { getDb } from '@/lib/db';
async function main() {
  const db = getDb();
  if (!db) throw new Error('no db');

  const PROTOS = ['navi','suilend','scallop','alphalend','bucket'];

  console.log('=== Latest PoolSnapshot — ltv + liquidationThreshold per protocol ===');
  for (const p of PROTOS) {
    const rows = await db.$queryRawUnsafe(`
      SELECT symbol,
             ltv::float8 AS ltv,
             "liquidationThreshold"::float8 AS lt,
             timestamp
      FROM "PoolSnapshot"
      WHERE protocol = $1
        AND timestamp >= NOW() - INTERVAL '7 days'
      ORDER BY symbol, timestamp DESC
    `, p) as any[];
    // Dedupe to latest per symbol
    const latest = new Map<string, any>();
    for (const r of rows) if (!latest.has(r.symbol)) latest.set(r.symbol, r);
    const arr = [...latest.values()];
    const nonZero = arr.filter(r => (r.ltv || 0) > 0 || (r.lt || 0) > 0);
    console.log(`\n  ${p}:  ${arr.length} markets · ${nonZero.length} with non-zero ltv/lt`);
    arr.slice(0, 5).forEach(r => {
      console.log(`    ${r.symbol.padEnd(28)} ltv=${(r.ltv*100).toFixed(2)}%  lt=${(r.lt*100).toFixed(2)}%`);
    });
  }

  console.log('\n=== RateModelParams — reserveFactor per protocol ===');
  for (const p of PROTOS) {
    const rows = await db.$queryRawUnsafe(`
      SELECT symbol,
             "baseRate"::float8 AS base,
             multiplier::float8 AS mult,
             "jumpMultiplier"::float8 AS jump,
             kink::float8 AS kink,
             "reserveFactor"::float8 AS rf
      FROM "RateModelParams"
      WHERE protocol = $1
      ORDER BY symbol
    `, p) as any[];
    const nonZeroRf = rows.filter(r => (r.rf || 0) > 0);
    console.log(`\n  ${p}:  ${rows.length} entries · ${nonZeroRf.length} with non-zero reserveFactor`);
    rows.slice(0, 4).forEach(r => {
      console.log(`    ${r.symbol.padEnd(28)} base=${r.base}  mult=${r.mult}  jump=${r.jump}  kink=${r.kink}  rf=${r.rf}`);
    });
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
