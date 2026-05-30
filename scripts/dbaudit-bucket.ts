import { getDb } from '@/lib/db';

async function main() {
  const db = getDb();
  if (!db) { console.error('no db'); return; }

  // Latest PoolSnapshot for Bucket
  const latest = await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (symbol)
      protocol, symbol, timestamp,
      "totalSupply"::float8 AS "totalSupply",
      "totalSupplyUsd"::float8 AS "totalSupplyUsd",
      "totalBorrows"::float8 AS "totalBorrows",
      "totalBorrowsUsd"::float8 AS "totalBorrowsUsd",
      price::float8 AS price
    FROM "PoolSnapshot"
    WHERE protocol = 'bucket'
    ORDER BY symbol, timestamp DESC
  `) as any[];

  console.log('=== Bucket latest PoolSnapshot by symbol (sorted by supplyUsd) ===');
  const sorted = [...latest].sort((a, b) => b.totalSupplyUsd - a.totalSupplyUsd);
  for (const r of sorted.slice(0, 15)) {
    console.log(`  ${r.symbol.padEnd(40)} supplyUsd=$${(r.totalSupplyUsd/1e6).toFixed(4)}M  qty=${r.totalSupply.toExponential(3)}  price=${r.price}  t=${r.timestamp.toISOString().slice(0,16)}`);
  }
  console.log(`  ... ${sorted.length} rows total`);

  console.log('\n=== BKT-AF-AFSUI-SUI history (last 15 days from PoolSnapshot) ===');
  const hist = await db.$queryRawUnsafe(`
    SELECT date_trunc('day', timestamp) AS day,
           AVG("totalSupplyUsd")::float8 AS avg_usd,
           MAX("totalSupplyUsd")::float8 AS max_usd,
           AVG("totalSupply")::float8 AS avg_qty,
           AVG(price)::float8 AS avg_price,
           COUNT(*)::int AS n
    FROM "PoolSnapshot"
    WHERE protocol = 'bucket' AND symbol = 'BKT-AF-AFSUI-SUI'
    GROUP BY 1 ORDER BY 1 DESC LIMIT 15
  `) as any[];
  for (const r of hist) {
    console.log(`  ${r.day.toISOString().slice(0,10)}  n=${r.n}  avgUsd=$${(r.avg_usd/1e6).toFixed(2)}M  maxUsd=$${(r.max_usd/1e6).toFixed(2)}M  qty=${r.avg_qty?.toExponential(3)}  price=${r.avg_price?.toFixed(4)}`);
  }

  console.log('\n=== PoolDaily for bucket last 5 days ===');
  const pd = await db.$queryRawUnsafe(`
    SELECT date, symbol,
           "closeTotalSupplyUsd"::float8 AS supply,
           "closeTotalBorrowsUsd"::float8 AS borrow
    FROM "PoolDaily"
    WHERE protocol = 'bucket' AND date >= NOW() - INTERVAL '5 days'
    ORDER BY date DESC, supply DESC
    LIMIT 40
  `) as any[];
  for (const r of pd) {
    console.log(`  ${r.date.toISOString().slice(0,10)}  ${r.symbol.padEnd(40)}  $${(r.supply/1e6).toFixed(3)}M`);
  }

  console.log('\n=== PoolDaily sum-by-day for bucket last 30 days ===');
  const pdSum = await db.$queryRawUnsafe(`
    SELECT date,
           SUM("closeTotalSupplyUsd")::float8 AS supply,
           SUM("closeTotalBorrowsUsd")::float8 AS borrow,
           COUNT(*)::int AS n
    FROM "PoolDaily"
    WHERE protocol = 'bucket' AND date >= NOW() - INTERVAL '30 days'
    GROUP BY date ORDER BY date DESC LIMIT 30
  `) as any[];
  for (const r of pdSum) {
    console.log(`  ${r.date.toISOString().slice(0,10)}  n=${r.n}  Σsupply=$${(r.supply/1e6).toFixed(3)}M  Σborrow=$${(r.borrow/1e6).toFixed(3)}M`);
  }

  console.log('\n=== DefillamaTvl for bucket last 30 days ===');
  const dl = await db.$queryRawUnsafe(`
    SELECT date, "tvlUsd"::float8 AS tvl
    FROM "DefillamaTvl"
    WHERE protocol = 'bucket' AND date >= NOW() - INTERVAL '30 days'
    ORDER BY date DESC
  `) as any[];
  for (const r of dl) {
    console.log(`  ${r.date.toISOString().slice(0,10)}  $${(r.tvl/1e6).toFixed(3)}M`);
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
