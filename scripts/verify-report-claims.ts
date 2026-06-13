// Re-derive every numeric claim in the State of Lending May 2026 report
// directly from the DB. Do not trust the report. Do not trust the audit.
// Just look at the data.
import { getDb } from '@/lib/db';

(async () => {
  const db = getDb(); if (!db) throw new Error('no db');

  // ── 1. TVL trajectory per protocol, May 1 vs May 31 (DefillamaTvl) ──
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('1. TVL trajectory May 1 vs May 31 (DefillamaTvl)');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const proto of ['navi','suilend','scallop','alphalend','bucket']) {
    const rows = (await db.$queryRawUnsafe(`
      SELECT date, "tvlUsd"::float8 AS tvl
      FROM "DefillamaTvl"
      WHERE protocol = $1 AND date IN ('2026-05-01'::date, '2026-05-31'::date)
      ORDER BY date
    `, proto)) as any[];
    if (rows.length >= 2) {
      const m1 = rows[0].tvl / 1e6, m31 = rows[1].tvl / 1e6;
      const ch = ((m31 - m1) / m1) * 100;
      console.log(`  ${proto.padEnd(10)} May 1: $${m1.toFixed(2)}M → May 31: $${m31.toFixed(2)}M  (${ch.toFixed(2)}%)`);
    } else {
      console.log(`  ${proto.padEnd(10)} incomplete (${rows.length} rows)`);
    }
  }

  // ── 2. Sector TVL totals ─────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('2. Sector TVL totals + growth');
  console.log('═══════════════════════════════════════════════════════════════');
  const sec = (await db.$queryRawUnsafe(`
    SELECT date, SUM("tvlUsd")::float8 AS tvl, COUNT(*)::int AS n
    FROM "DefillamaTvl"
    WHERE date IN ('2026-05-01'::date, '2026-05-31'::date)
    GROUP BY date ORDER BY date
  `)) as any[];
  for (const r of sec) {
    console.log(`  ${r.date.toISOString().slice(0,10)}  $${(r.tvl/1e6).toFixed(2)}M  (${r.n} protocols summed)`);
  }
  if (sec.length === 2) {
    const ch = ((sec[1].tvl - sec[0].tvl) / sec[0].tvl) * 100;
    console.log(`  Sector growth: ${ch.toFixed(2)}%`);
  }

  // ── 3. HHI on actual May 31 shares ────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('3. HHI on May 31 TVL shares');
  console.log('═══════════════════════════════════════════════════════════════');
  const may31 = (await db.$queryRawUnsafe(`
    SELECT protocol, "tvlUsd"::float8 AS tvl
    FROM "DefillamaTvl"
    WHERE date = '2026-05-31'::date
    ORDER BY tvl DESC
  `)) as any[];
  const total = may31.reduce((s, r) => s + r.tvl, 0);
  let hhi = 0;
  for (const r of may31) {
    const share = (r.tvl / total) * 100;
    hhi += share * share;
    console.log(`  ${r.protocol.padEnd(10)}  $${(r.tvl/1e6).toFixed(2)}M  share=${share.toFixed(2)}%  share²=${(share*share).toFixed(1)}`);
  }
  console.log(`  Sector HHI: ${hhi.toFixed(1)} (highly-concentrated threshold: 2500 per 2010 HMG)`);
  console.log(`  NAVI+Suilend combined share: ${((may31[0].tvl + may31[1].tvl) / total * 100).toFixed(1)}%`);

  // ── 4. Liquidation events in May 2026 ─────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('4. Liquidation events in May 2026');
  console.log('═══════════════════════════════════════════════════════════════');
  const liq = (await db.$queryRawUnsafe(`
    SELECT protocol,
           COUNT(*)::int AS raw,
           COUNT(*) FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::int AS filtered,
           SUM("debtUsd") FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::float8 AS debt,
           SUM("collateralUsd") FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::float8 AS coll,
           AVG("debtUsd") FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::float8 AS avg_debt,
           COUNT(DISTINCT borrower) FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::int AS borrowers,
           COUNT(DISTINCT liquidator) FILTER (WHERE "debtUsd" >= 1 OR "collateralUsd" >= 1)::int AS liqs
    FROM "LiquidationEvent"
    WHERE timestamp >= '2026-05-01'::timestamp AND timestamp < '2026-06-01'::timestamp
    GROUP BY protocol ORDER BY protocol
  `)) as any[];
  let totalRaw = 0, totalFiltered = 0, totalDebt = 0;
  console.log(`  protocol     raw  filtered  debt$         coll$        avg$    borrowers  liqs`);
  for (const r of liq) {
    totalRaw += r.raw; totalFiltered += r.filtered; totalDebt += (r.debt || 0);
    console.log(`  ${r.protocol.padEnd(10)} ${String(r.raw).padStart(4)}  ${String(r.filtered).padStart(7)}  $${(r.debt||0).toFixed(0).padStart(10)}  $${(r.coll||0).toFixed(0).padStart(9)}  $${(r.avg_debt||0).toFixed(0).padStart(5)}  ${String(r.borrowers).padStart(8)}  ${r.liqs}`);
  }
  console.log(`  TOTAL          raw=${totalRaw}  filtered=${totalFiltered}  debt=$${(totalDebt/1e6).toFixed(3)}M (sub-$ filter dropped ${((totalRaw-totalFiltered)/totalRaw*100).toFixed(1)}%)`);

  // ── 5. Deduplicated sector-wide distinct liquidator count ─────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('5. Distinct liquidators — per-protocol vs deduplicated sector union');
  console.log('═══════════════════════════════════════════════════════════════');
  const dedup = (await db.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT liquidator)::int AS dedup
    FROM "LiquidationEvent"
    WHERE timestamp >= '2026-05-01'::timestamp AND timestamp < '2026-06-01'::timestamp
      AND ("debtUsd" >= 1 OR "collateralUsd" >= 1)
  `)) as any[];
  const perProtoSum = liq.reduce((s, r) => s + r.liqs, 0);
  console.log(`  Sum of per-protocol distinct liquidator counts: ${perProtoSum}`);
  console.log(`  Deduplicated sector-wide distinct liquidators:  ${dedup[0].dedup}`);
  console.log(`  Cross-protocol overlap (address operating on multiple): ${perProtoSum - dedup[0].dedup}`);

  // Top liquidator per protocol
  console.log('\n  Top 1 liquidator per protocol (share of events):');
  for (const proto of ['navi','suilend','scallop','alphalend']) {
    const top = (await db.$queryRawUnsafe(`
      SELECT liquidator, COUNT(*)::int AS n
      FROM "LiquidationEvent"
      WHERE protocol = $1
        AND timestamp >= '2026-05-01'::timestamp AND timestamp < '2026-06-01'::timestamp
        AND ("debtUsd" >= 1 OR "collateralUsd" >= 1)
      GROUP BY liquidator ORDER BY n DESC LIMIT 1
    `, proto)) as any[];
    const totalProto = liq.find(l => l.protocol === proto)?.filtered ?? 1;
    if (top[0]) {
      console.log(`  ${proto.padEnd(10)} top addr: ${top[0].liquidator.slice(0,12)}…  ${top[0].n}/${totalProto} = ${(top[0].n/totalProto*100).toFixed(1)}%`);
    }
  }

  // ── 6. Weekly liquidation pattern ─────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('6. May weekly liquidation pattern (real events)');
  console.log('═══════════════════════════════════════════════════════════════');
  const wk = (await db.$queryRawUnsafe(`
    SELECT date_trunc('week', timestamp)::date AS wk,
           COUNT(*)::int AS events,
           SUM("debtUsd")::float8 AS debt,
           AVG("debtUsd")::float8 AS avg_debt,
           MIN(timestamp) AS first, MAX(timestamp) AS last
    FROM "LiquidationEvent"
    WHERE timestamp >= '2026-05-01'::timestamp AND timestamp < '2026-06-01'::timestamp
      AND ("debtUsd" >= 1 OR "collateralUsd" >= 1)
    GROUP BY 1 ORDER BY 1
  `)) as any[];
  for (const r of wk) {
    const spanHours = (new Date(r.last).getTime() - new Date(r.first).getTime()) / 3600000;
    const minutesPerEvent = r.events > 0 ? (spanHours * 60) / r.events : 0;
    console.log(`  week of ${r.wk.toISOString().slice(0,10)}  events=${String(r.events).padStart(4)}  debt=$${(r.debt/1e6).toFixed(3)}M  avg=$${r.avg_debt.toFixed(0)}  cadence=${minutesPerEvent.toFixed(1)}min/event over actual span`);
  }

  // Also: cadence on a 7-day basis for whichever week had the most debt
  const heavyWeek = wk.reduce((a, b) => (b.debt > a.debt ? b : a), wk[0]);
  if (heavyWeek) {
    const oneWeekMinutes = 7 * 24 * 60;
    console.log(`  Heavy week of ${heavyWeek.wk.toISOString().slice(0,10)}: ${heavyWeek.events} events / 7d = 1 event per ${(oneWeekMinutes / heavyWeek.events).toFixed(1)} min on a calendar-week basis`);
  }

  // ── 7. NAVI risk parameters — RateModelParams ─────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('7. NAVI risk parameters (RateModelParams)');
  console.log('═══════════════════════════════════════════════════════════════');
  const naviRmp = (await db.$queryRawUnsafe(`
    SELECT symbol, ltv::float8, "liquidationThreshold"::float8 AS lt,
           "reserveFactor"::float8 AS rf, kink::float8
    FROM "RateModelParams"
    WHERE protocol = 'navi'
    ORDER BY symbol
  `)) as any[];
  const naviBorrowOnly = naviRmp.filter(r => r.ltv === 0 && r.lt > 0);
  console.log(`  NAVI markets total: ${naviRmp.length}`);
  console.log(`  NAVI markets with ltv=0 AND lt>0 (borrow-only): ${naviBorrowOnly.length}`);
  console.log(`  Specifically: ${naviBorrowOnly.map(r => r.symbol).join(', ')}`);
  console.log(`\n  Sample of NAVI risk params (5 collateral-enabled):`);
  for (const r of naviRmp.filter(r => r.ltv > 0).slice(0, 8)) {
    console.log(`    ${r.symbol.padEnd(10)} ltv=${(r.ltv*100).toFixed(0)}%  lt=${(r.lt*100).toFixed(0)}%  rf=${(r.rf*100).toFixed(0)}%  kink=${(r.kink*100).toFixed(0)}%`);
  }

  // ── 8. Cross-protocol asset LT comparison for key assets ──────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('8. Cross-protocol LT comparison (SUI, USDC, USDT, WBTC, ETH/WETH)');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const sym of ['SUI', 'USDC', 'USDT', 'WBTC', 'WETH', 'ETH', 'BTC']) {
    const rows = (await db.$queryRawUnsafe(`
      SELECT protocol, "liquidationThreshold"::float8 AS lt
      FROM "RateModelParams"
      WHERE symbol = $1 AND "liquidationThreshold" > 0
      ORDER BY protocol
    `, sym)) as any[];
    if (rows.length > 0) {
      const cells = rows.map(r => `${r.protocol}=${(r.lt*100).toFixed(0)}%`).join('  ');
      console.log(`  ${sym.padEnd(8)} ${cells}`);
    }
  }

  // ── 9. Active market count + Bucket vault count ───────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('9. Active market counts (latest snapshot per protocol, last 7d)');
  console.log('═══════════════════════════════════════════════════════════════');
  const markets = (await db.$queryRawUnsafe(`
    SELECT protocol, COUNT(DISTINCT symbol)::int AS markets
    FROM "PoolSnapshot"
    WHERE timestamp >= NOW() - INTERVAL '7 days'
    GROUP BY protocol ORDER BY protocol
  `)) as any[];
  let totalMarkets = 0;
  for (const r of markets) {
    totalMarkets += r.markets;
    console.log(`  ${r.protocol.padEnd(10)} ${r.markets}`);
  }
  console.log(`  TOTAL across 5 protocols: ${totalMarkets}`);

  // ── 10. Current sector supply / borrow (live state) ───────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('10. Current sector supply / borrow (latest PoolSnapshot)');
  console.log('═══════════════════════════════════════════════════════════════');
  const sb = (await db.$queryRawUnsafe(`
    SELECT protocol,
           SUM("totalSupplyUsd")::float8 AS sup,
           SUM("totalBorrowsUsd")::float8 AS bor
    FROM (
      SELECT DISTINCT ON (protocol, symbol)
        protocol, symbol, "totalSupplyUsd", "totalBorrowsUsd"
      FROM "PoolSnapshot"
      WHERE timestamp >= NOW() - INTERVAL '7 days'
      ORDER BY protocol, symbol, timestamp DESC
    ) latest
    GROUP BY protocol ORDER BY protocol
  `)) as any[];
  let totSup = 0, totBor = 0;
  for (const r of sb) {
    totSup += r.sup; totBor += r.bor;
    console.log(`  ${r.protocol.padEnd(10)} supply=$${(r.sup/1e6).toFixed(1)}M  borrow=$${(r.bor/1e6).toFixed(1)}M`);
  }
  console.log(`  Sector supply: $${(totSup/1e6).toFixed(1)}M  borrow: $${(totBor/1e6).toFixed(1)}M  net (sup-bor): $${((totSup-totBor)/1e6).toFixed(1)}M`);

  // ── 11. Bucket USDB outstanding ──────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('11. Bucket USDB issuance');
  console.log('═══════════════════════════════════════════════════════════════');
  const buck = (await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (symbol) symbol,
           "totalSupplyUsd"::float8 AS sup,
           "totalBorrowsUsd"::float8 AS bor
    FROM "PoolSnapshot"
    WHERE protocol = 'bucket' AND timestamp >= NOW() - INTERVAL '7 days'
    ORDER BY symbol, timestamp DESC
  `)) as any[];
  const totalCollat = buck.reduce((s, r) => s + r.sup, 0);
  const totalDebtUsdb = buck.reduce((s, r) => s + r.bor, 0);
  console.log(`  Bucket vaults total collateral: $${(totalCollat/1e6).toFixed(2)}M`);
  console.log(`  Bucket vaults total debt (USDB issued via CDPs): $${(totalDebtUsdb/1e6).toFixed(2)}M`);
  console.log(`  Backing ratio: ${totalDebtUsdb > 0 ? (totalCollat/totalDebtUsdb*100).toFixed(0) + '%' : 'n/a'}`);

  // ── 12. Stablecoin vs SUI/LST share of sector ────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('12. Stablecoin borrow share + SUI/LST collateral share');
  console.log('═══════════════════════════════════════════════════════════════');
  const all = (await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (protocol, symbol)
      protocol, symbol,
      "totalSupplyUsd"::float8 AS sup,
      "totalBorrowsUsd"::float8 AS bor
    FROM "PoolSnapshot"
    WHERE timestamp >= NOW() - INTERVAL '7 days'
    ORDER BY protocol, symbol, timestamp DESC
  `)) as any[];
  const STABLES = new Set(['USDC','USDT','suiUSDT','wUSDC','wUSDT','USDsui','USDSUI','USDB','BUCK','AUSD','FDUSD','USDY','mUSD']);
  const SUI_LSTS = new Set(['SUI','vSUI','haSUI','sSUI','afSUI','stSUI']);
  let stableBor = 0, totalBor2 = 0, suiCollat = 0, totalCollat2 = 0;
  for (const r of all) {
    totalBor2 += r.bor; totalCollat2 += r.sup;
    if (STABLES.has(r.symbol)) stableBor += r.bor;
    if (SUI_LSTS.has(r.symbol)) suiCollat += r.sup;
  }
  console.log(`  Total sector borrow: $${(totalBor2/1e6).toFixed(1)}M`);
  console.log(`  Stablecoin borrow:   $${(stableBor/1e6).toFixed(1)}M  (${(stableBor/totalBor2*100).toFixed(1)}%)`);
  console.log(`  Total sector supply: $${(totalCollat2/1e6).toFixed(1)}M`);
  console.log(`  SUI+LST collateral:  $${(suiCollat/1e6).toFixed(1)}M  (${(suiCollat/totalCollat2*100).toFixed(1)}%)`);

  await db.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
