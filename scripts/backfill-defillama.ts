/**
 * One-time import of DefiLlama TVL history for NAVI Protocol.
 *
 * Usage: npx tsx scripts/backfill-defillama.ts
 *
 * Requires: DATABASE_URL
 */

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();

  console.log('Fetching NAVI Protocol TVL from DefiLlama...');

  const res = await fetch('https://api.llama.fi/protocol/navi-protocol');
  if (!res.ok) {
    console.error(`DefiLlama API returned ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  const tvlHistory: Array<{ date: number; totalLiquidityUSD: number }> = data.tvl ?? [];

  console.log(`Found ${tvlHistory.length} daily TVL data points`);

  const PROTOCOL = 'navi';
  let inserted = 0;
  let failed = 0;
  for (const entry of tvlHistory) {
    if (typeof entry?.totalLiquidityUSD !== 'number' || !Number.isFinite(entry.totalLiquidityUSD)) {
      continue;
    }
    const date = new Date(entry.date * 1000);
    date.setUTCHours(0, 0, 0, 0);

    try {
      await db.defillamaTvl.upsert({
        where: { protocol_date: { protocol: PROTOCOL, date } },
        create: { protocol: PROTOCOL, date, tvlUsd: entry.totalLiquidityUSD },
        update: { tvlUsd: entry.totalLiquidityUSD },
      });
      inserted++;
    } catch (err) {
      failed++;
      console.warn(
        `  skip ${date.toISOString().slice(0, 10)}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  if (failed > 0) console.log(`${failed} rows failed to insert`);

  console.log(`Done! Inserted/updated ${inserted} TVL records`);
  await db.$disconnect();
}

main().catch(console.error);
