/**
 * P0.3 — Liquidation event-type discovery crawler.
 *
 * Pages each protocol's `MoveEventModule` events with backoff, looking for any
 * event whose type contains "Liquid" (case-insensitive). Reports the FULL event
 * type string + field shape per match so the adapter constants can be updated.
 *
 * Run:
 *   BLOCKVISION_SUI_RPC=https://… npx tsx scripts/crawl-liq-events.mts
 *
 * The crawler is intentionally slow (1-2s between calls) to avoid public RPC
 * rate limits.
 */

const RPC = process.env.BLOCKVISION_SUI_RPC ?? 'https://fullnode.mainnet.sui.io:443';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface SuiEvent {
  id: { txDigest: string; eventSeq: string };
  type: string;
  parsedJson: Record<string, unknown>;
  timestampMs: string;
}
interface Page { data: SuiEvent[]; nextCursor: { txDigest: string; eventSeq: string } | null; hasNextPage: boolean; }

async function rpc<T>(method: string, params: unknown[] = [], retries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await res.json();
      if (j.error) {
        if (/rate.?limit/i.test(j.error.message) && attempt < retries) {
          attempt += 1;
          const wait = 2000 * attempt;
          console.log(`    rate-limited, sleeping ${wait}ms (attempt ${attempt}/${retries})`);
          await sleep(wait);
          continue;
        }
        throw new Error(j.error.message);
      }
      return j.result as T;
    } catch (e) {
      if (attempt < retries) {
        attempt += 1;
        await sleep(1500 * attempt);
        continue;
      }
      throw e;
    }
  }
}

async function crawlModule(label: string, packageId: string, modules: string[], maxPages = 8) {
  console.log(`\n══ ${label} ══`);
  const liquidationEvents = new Map<string, SuiEvent>();
  const allTypesSeen = new Map<string, number>();

  for (const mod of modules) {
    let cursor: any = null;
    for (let p = 0; p < maxPages; p++) {
      try {
        const filter = { MoveEventModule: { package: packageId, module: mod } };
        const page = await rpc<Page>('suix_queryEvents', [filter, cursor, 50, true]);
        for (const evt of page.data) {
          allTypesSeen.set(evt.type, (allTypesSeen.get(evt.type) || 0) + 1);
          if (/liquidat/i.test(evt.type) && !liquidationEvents.has(evt.type)) {
            liquidationEvents.set(evt.type, evt);
          }
        }
        if (!page.hasNextPage) break;
        cursor = page.nextCursor;
        await sleep(1500);
      } catch (e) {
        console.log(`    ${mod} p${p}: ${(e as Error).message.slice(0, 80)}`);
        break;
      }
    }
    console.log(`  ${mod}: ${allTypesSeen.size} unique types seen so far`);
    await sleep(1500);
  }

  if (liquidationEvents.size === 0) {
    console.log(`  ⚠ NO liquidation events found in modules: ${modules.join(', ')}`);
    console.log('  Top 5 event types observed (for reference):');
    [...allTypesSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([t, c]) => console.log(`    ${c}× ${t.slice(0, 110)}`));
    return;
  }
  console.log(`  ✓ FOUND ${liquidationEvents.size} liquidation event type(s):`);
  for (const [type, evt] of liquidationEvents) {
    console.log(`\n    ${type}`);
    console.log(`    fields: ${Object.keys(evt.parsedJson).join(', ')}`);
    console.log(`    sample: ${JSON.stringify(evt.parsedJson).slice(0, 400)}`);
    console.log(`    txDigest: ${evt.id.txDigest}`);
  }
}

(async () => {
  // Scallop — modules from their open-source NestJS indexer (sui-scallop-indexer)
  await crawlModule(
    'Scallop',
    '0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c',
    ['liquidate', 'protocol', 'borrow_dynamic', 'mint', 'redeem'],
  );

  // AlphaLend — first package
  await crawlModule(
    'AlphaLend',
    '0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4',
    ['lending_protocol', 'position', 'liquidate', 'oracle'],
  );

  // Bucket V2 CDP package
  await crawlModule(
    'Bucket V2',
    '0xc63072e7f5f4983a2efaf5bdba1480d5e7d74d57948e1c7cc436f8e22cbeb410',
    ['cdp', 'vault', 'liquidate', 'fountain'],
  );
})();
