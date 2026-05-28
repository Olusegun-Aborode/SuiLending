/**
 * Import DefiLlama daily TVL history for ALL Sui lending protocols.
 *
 * Fills the historical gaps in the dashboard's TVL-by-Protocol chart. Our
 * own PoolDaily history is sparse for the non-NAVI protocols (their
 * collect-pools/aggregate-daily crons failed for long stretches), so the
 * route falls back to this DefillamaTvl table for any day it has no
 * PoolDaily-derived value.
 *
 * DefiLlama's `/protocol/<slug>` endpoint returns `tvl: [{date, totalLiquidityUSD}]`
 * going back 1-3 years for each protocol. We upsert one row per (protocol, date).
 *
 * Usage:  set -a && source .env.local && set +a && npx tsx scripts/backfill-defillama.ts
 * Requires: DATABASE_URL
 *
 * Methodology note: DefiLlama's TVL uses its own per-protocol definition,
 * which for the "net" protocols (NAVI/Suilend/AlphaLend, where our live
 * value is supply−borrow) may sit slightly above our live number — so a
 * small step can appear where backfilled history meets live data at the
 * chart's right edge. For Scallop/Bucket (we already serve DefiLlama 'remote'
 * live) it's seamless.
 */

// Map our internal protocol slug → DefiLlama protocol slug.
const PROTOCOL_LLAMA_SLUG: Record<string, string> = {
  navi:      'navi-protocol',
  suilend:   'suilend',
  scallop:   'scallop',
  alphalend: 'alphalend',
  bucket:    'bucket-protocol',
};

interface LlamaTvlPoint { date: number; totalLiquidityUSD: number }

async function backfillOne(
  db: { defillamaTvl: { upsert: (a: unknown) => Promise<unknown> } },
  protocol: string,
  slug: string,
): Promise<{ inserted: number; failed: number; span: string }> {
  const res = await fetch(`https://api.llama.fi/protocol/${slug}`);
  if (!res.ok) {
    console.warn(`  [${protocol}] DefiLlama ${slug} returned HTTP ${res.status} — skipping`);
    return { inserted: 0, failed: 0, span: 'n/a' };
  }
  const data = await res.json() as { tvl?: LlamaTvlPoint[] };
  const history = data.tvl ?? [];
  if (history.length === 0) {
    console.warn(`  [${protocol}] no tvl history from DefiLlama`);
    return { inserted: 0, failed: 0, span: 'empty' };
  }

  let inserted = 0, failed = 0;
  let first = '', last = '';
  for (const entry of history) {
    if (typeof entry?.totalLiquidityUSD !== 'number' || !Number.isFinite(entry.totalLiquidityUSD)) continue;
    const date = new Date(entry.date * 1000);
    date.setUTCHours(0, 0, 0, 0);
    const dStr = date.toISOString().slice(0, 10);
    if (!first) first = dStr;
    last = dStr;
    try {
      await db.defillamaTvl.upsert({
        where: { protocol_date: { protocol, date } },
        create: { protocol, date, tvlUsd: entry.totalLiquidityUSD },
        update: { tvlUsd: entry.totalLiquidityUSD },
      });
      inserted++;
    } catch (err) {
      failed++;
      if (failed <= 3) console.warn(`    [${protocol}] skip ${dStr}:`, err instanceof Error ? err.message : err);
    }
  }
  return { inserted, failed, span: `${first} → ${last}` };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();

  console.log('Backfilling DefiLlama TVL history for all 5 protocols…\n');
  let grandTotal = 0;
  for (const [protocol, slug] of Object.entries(PROTOCOL_LLAMA_SLUG)) {
    const { inserted, failed, span } = await backfillOne(db as never, protocol, slug);
    grandTotal += inserted;
    console.log(`  ${protocol.padEnd(10)} ${String(inserted).padStart(5)} rows  (${span})${failed ? `  [${failed} failed]` : ''}`);
  }
  console.log(`\nDone — ${grandTotal} total DefillamaTvl rows upserted.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
