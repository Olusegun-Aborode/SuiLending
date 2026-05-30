// Sweep the whole DB for any other ghost rows / suspicious values.
// Patterns we check for: per-protocol top-1 supply > 50% of protocol total,
// supply > $200M anywhere, missing prices on non-dust rows, PoolDaily gaps.
import { getDb } from '@/lib/db';

async function main() {
  const db = getDb();
  if (!db) throw new Error('no db');

  const SINCE_DAYS = 7;
  const freshSince = new Date(Date.now() - SINCE_DAYS * 86400 * 1000);

  console.log('=== Latest PoolSnapshot per (protocol, symbol), top 12 by supplyUsd ===');
  const top = await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (protocol, symbol)
      protocol, symbol,
      "totalSupplyUsd"::float8 AS supply,
      "totalBorrowsUsd"::float8 AS borrow,
      price::float8 AS price,
      timestamp
    FROM "PoolSnapshot"
    WHERE timestamp >= $1
    ORDER BY protocol, symbol, timestamp DESC
  `, freshSince) as any[];
  const sortedTop = [...top].sort((a, b) => b.supply - a.supply).slice(0, 12);
  for (const r of sortedTop) {
    console.log(`  ${r.protocol.padEnd(10)} ${r.symbol.padEnd(35)} supply=$${(r.supply/1e6).toFixed(2)}M  price=${r.price?.toFixed(4)}  t=${r.timestamp.toISOString().slice(0,16)}`);
  }

  console.log('\n=== Protocol totals (sum of latest snapshots) ===');
  const totals: Record<string, { supply: number; borrow: number; n: number; maxRow: number; maxSym: string }> = {};
  for (const r of top) {
    const k = r.protocol;
    if (!totals[k]) totals[k] = { supply: 0, borrow: 0, n: 0, maxRow: 0, maxSym: '' };
    totals[k].supply += r.supply;
    totals[k].borrow += r.borrow;
    totals[k].n++;
    if (r.supply > totals[k].maxRow) { totals[k].maxRow = r.supply; totals[k].maxSym = r.symbol; }
  }
  for (const [proto, v] of Object.entries(totals)) {
    const pct = v.supply > 0 ? (v.maxRow / v.supply * 100).toFixed(0) : '0';
    console.log(`  ${proto.padEnd(10)} n=${v.n}  Σsupply=$${(v.supply/1e6).toFixed(2)}M  Σborrow=$${(v.borrow/1e6).toFixed(2)}M  top row: ${v.maxSym} = $${(v.maxRow/1e6).toFixed(2)}M (${pct}% of protocol)`);
  }

  console.log('\n=== Non-dust rows with price = 0 (stale-collateral candidates) ===');
  const stale = top.filter(r => r.supply >= 100_000 && (!r.price || r.price === 0));
  if (stale.length === 0) console.log('  none');
  for (const r of stale) {
    console.log(`  ${r.protocol}/${r.symbol}  supply=$${(r.supply/1e6).toFixed(3)}M`);
  }

  console.log('\n=== PoolDaily coverage by protocol (last 90 days) ===');
  const cov = await db.$queryRawUnsafe(`
    SELECT protocol, COUNT(DISTINCT date)::int AS days, MIN(date) AS first, MAX(date) AS last
    FROM "PoolDaily"
    WHERE date >= NOW() - INTERVAL '90 days'
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  for (const r of cov) {
    console.log(`  ${r.protocol.padEnd(10)} ${r.days}/90 days  first=${r.first.toISOString().slice(0,10)}  last=${r.last.toISOString().slice(0,10)}`);
  }

  console.log('\n=== DefillamaTvl coverage by protocol (last 90 days) ===');
  const dlcov = await db.$queryRawUnsafe(`
    SELECT protocol, COUNT(*)::int AS days, MIN(date) AS first, MAX(date) AS last,
           AVG("tvlUsd")::float8 AS avg_tvl
    FROM "DefillamaTvl"
    WHERE date >= NOW() - INTERVAL '90 days'
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  for (const r of dlcov) {
    console.log(`  ${r.protocol.padEnd(10)} ${r.days}/90 days  first=${r.first.toISOString().slice(0,10)}  last=${r.last.toISOString().slice(0,10)}  avgTvl=$${(r.avg_tvl/1e6).toFixed(2)}M`);
  }

  console.log('\n=== Liquidation event coverage (last 30 days) ===');
  const lq = await db.$queryRawUnsafe(`
    SELECT protocol, COUNT(*)::int AS events, MIN(timestamp) AS first, MAX(timestamp) AS last,
           SUM("debtUsd")::float8 AS total_repaid
    FROM "LiquidationEvent"
    WHERE timestamp >= NOW() - INTERVAL '30 days'
    GROUP BY protocol ORDER BY protocol
  `) as any[];
  for (const r of lq) {
    console.log(`  ${r.protocol.padEnd(10)} ${r.events} events  first=${r.first?.toISOString().slice(0,16)}  last=${r.last?.toISOString().slice(0,16)}  Σrepaid=$${(r.total_repaid/1e6).toFixed(3)}M`);
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
