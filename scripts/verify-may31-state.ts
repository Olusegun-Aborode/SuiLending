import { getDb } from '@/lib/db';
(async () => {
  const db = getDb(); if (!db) throw new Error('no db');

  // ── A. Actual May 31 supply/borrow snapshot (not today's) ─────────
  console.log('A. Sector supply / borrow as-of May 31 (latest PoolSnapshot ≤ 2026-05-31)');
  const sb = (await db.$queryRawUnsafe(`
    SELECT protocol,
           SUM("totalSupplyUsd")::float8 AS sup,
           SUM("totalBorrowsUsd")::float8 AS bor
    FROM (
      SELECT DISTINCT ON (protocol, symbol)
        protocol, symbol, "totalSupplyUsd", "totalBorrowsUsd", timestamp
      FROM "PoolSnapshot"
      WHERE timestamp >= '2026-05-25'::timestamp AND timestamp <= '2026-06-01'::timestamp
      ORDER BY protocol, symbol, timestamp DESC
    ) t
    GROUP BY protocol ORDER BY protocol
  `)) as any[];
  let totSup = 0, totBor = 0;
  for (const r of sb) {
    totSup += r.sup; totBor += r.bor;
    console.log(`   ${r.protocol.padEnd(10)} supply=$${(r.sup/1e6).toFixed(1)}M  borrow=$${(r.bor/1e6).toFixed(1)}M`);
  }
  console.log(`   Sector supply: $${(totSup/1e6).toFixed(1)}M  borrow: $${(totBor/1e6).toFixed(1)}M  sup-bor: $${((totSup-totBor)/1e6).toFixed(1)}M`);

  // ── B. Bucket on May 31 — vault breakdown ─────────────────────────
  console.log('\nB. Bucket May 31 vault breakdown (V2 USDB CDP vaults only — exclude PSM/Savings/V1)');
  const buck = (await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (symbol) symbol,
           "totalSupplyUsd"::float8 AS sup,
           "totalBorrowsUsd"::float8 AS bor
    FROM "PoolSnapshot"
    WHERE protocol = 'bucket'
      AND timestamp >= '2026-05-25'::timestamp AND timestamp <= '2026-06-01'::timestamp
    ORDER BY symbol, timestamp DESC
  `)) as any[];
  let cdpCollat = 0, cdpDebt = 0, psmCollat = 0;
  for (const r of buck) {
    const isCdp = !['PSM-','V1-','V1PSM-','BKT-PSM-','BKT-SAVE-','BKT-SCOIN-','BKT-AF-','BKT-KRIYA-','SAVING-'].some(p => r.symbol.startsWith(p));
    if (isCdp) { cdpCollat += r.sup; cdpDebt += r.bor; }
    else { psmCollat += r.sup; }
  }
  console.log(`   CDP-vault collateral (USDB-backing): $${(cdpCollat/1e6).toFixed(2)}M`);
  console.log(`   CDP-vault USDB outstanding:          $${(cdpDebt/1e6).toFixed(2)}M`);
  console.log(`   PSM / non-CDP surface collateral:    $${(psmCollat/1e6).toFixed(2)}M`);
  console.log(`   USDB backing ratio (CDP basis):      ${cdpDebt > 0 ? (cdpCollat/cdpDebt*100).toFixed(0)+'%' : 'n/a'}`);
  console.log(`   Total Bucket reported collateral:    $${((cdpCollat+psmCollat)/1e6).toFixed(2)}M`);

  // ── C. Stablecoin borrow share and SUI/LST collateral share — May 31 ──
  console.log('\nC. Stablecoin / SUI-LST shares as-of May 31');
  const all = (await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (protocol, symbol)
      protocol, symbol,
      "totalSupplyUsd"::float8 AS sup,
      "totalBorrowsUsd"::float8 AS bor
    FROM "PoolSnapshot"
    WHERE timestamp >= '2026-05-25'::timestamp AND timestamp <= '2026-06-01'::timestamp
    ORDER BY protocol, symbol, timestamp DESC
  `)) as any[];
  const STABLES = new Set(['USDC','USDT','suiUSDT','wUSDC','wUSDT','USDsui','USDSUI','USDB','BUCK','AUSD','FDUSD','USDY','mUSD']);
  const SUI_LSTS = new Set(['SUI','vSUI','haSUI','sSUI','afSUI','stSUI']);
  let stableBor = 0, totalBor = 0, suiCollat = 0, totalCollat = 0;
  for (const r of all) {
    totalBor += r.bor; totalCollat += r.sup;
    if (STABLES.has(r.symbol)) stableBor += r.bor;
    if (SUI_LSTS.has(r.symbol)) suiCollat += r.sup;
  }
  console.log(`   Sector borrow:        $${(totalBor/1e6).toFixed(1)}M`);
  console.log(`   Stablecoin borrow:    $${(stableBor/1e6).toFixed(1)}M  (${(stableBor/totalBor*100).toFixed(1)}%)`);
  console.log(`   Sector supply:        $${(totalCollat/1e6).toFixed(1)}M`);
  console.log(`   SUI + LST collateral: $${(suiCollat/1e6).toFixed(1)}M  (${(suiCollat/totalCollat*100).toFixed(1)}%)`);

  // ── D. NAVI WBTC — does the 98% RF claim hold? ────────────────────
  console.log('\nD. NAVI WBTC reserve factor check');
  const wbtc = (await db.$queryRawUnsafe(`
    SELECT symbol, "reserveFactor"::float8 AS rf, "liquidationThreshold"::float8 AS lt, ltv::float8
    FROM "RateModelParams"
    WHERE protocol = 'navi' AND symbol IN ('WBTC','MBTC','LBTC','XBTC','enzoBTC','sbWBTC','stBTC','TBTC')
    ORDER BY symbol
  `)) as any[];
  if (wbtc.length === 0) console.log('   no WBTC-class assets found in RateModelParams for navi');
  for (const r of wbtc) {
    console.log(`   ${r.symbol.padEnd(10)} ltv=${(r.ltv*100).toFixed(0)}%  lt=${(r.lt*100).toFixed(0)}%  rf=${(r.rf*100).toFixed(0)}%`);
  }

  // ── E. Sanity — sector TVL trajectory through May (DefillamaTvl, every week) ──
  console.log('\nE. Sector TVL each Sunday in May (DefillamaTvl)');
  const sundays = (await db.$queryRawUnsafe(`
    SELECT date, SUM("tvlUsd")::float8 AS tvl
    FROM "DefillamaTvl"
    WHERE date IN ('2026-05-01'::date, '2026-05-04'::date, '2026-05-11'::date, '2026-05-18'::date, '2026-05-25'::date, '2026-05-31'::date)
    GROUP BY date ORDER BY date
  `)) as any[];
  let prev = 0;
  for (const r of sundays) {
    const ch = prev > 0 ? ((r.tvl - prev)/prev*100).toFixed(2) + '%' : '—';
    console.log(`   ${r.date.toISOString().slice(0,10)}  $${(r.tvl/1e6).toFixed(2)}M  vs prev ${ch}`);
    prev = r.tvl;
  }

  await db.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
