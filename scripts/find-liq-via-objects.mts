/**
 * Smart liquidation event finder.
 *
 * Instead of guessing package IDs (which can be wrong — Suiscan revealed our
 * SCALLOP_PACKAGE was actually Aftermath's), this walks transactions that
 * touched each protocol's KNOWN lending market object via
 * suix_queryTransactionBlocks's `InputObject` filter. For each tx we fetch
 * the emitted events, find any with "liquid" in the type, and report the
 * first match per protocol.
 */

const RPC = process.env.BLOCKVISION_SUI_RPC ?? 'https://fullnode.mainnet.sui.io:443';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface SuiEvent { type: string; parsedJson: Record<string, unknown>; }
interface TxResp { digest: string; events?: SuiEvent[]; }
interface PageResp { data: Array<{ digest: string }>; nextCursor: string | null; hasNextPage: boolean; }

async function rpc<T>(method: string, params: unknown[] = [], retry = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await res.json();
      if (j.error) {
        if (/rate.?limit/i.test(j.error.message) && attempt < retry) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw new Error(j.error.message);
      }
      return j.result as T;
    } catch (e) {
      if (attempt < retry) { await sleep(1500 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

async function findLiquidationsForProtocol(label: string, lendingObjectId: string) {
  console.log(`\n══ ${label} ══`);
  console.log(`  walking txs that touched ${lendingObjectId.slice(0, 16)}…`);

  let cursor: string | null = null;
  const seen = new Set<string>();
  const liquidationTypes = new Map<string, { sample: SuiEvent; txDigest: string }>();
  const allEventTypes = new Map<string, number>();

  // Walk up to 10 pages of 50 txs each (= 500 most recent txs touching this object).
  for (let p = 0; p < 10; p++) {
    let page;
    try {
      page = await rpc<PageResp>('suix_queryTransactionBlocks', [
        { filter: { InputObject: lendingObjectId }, options: { showEvents: false } },
        cursor, 50, true, // descending
      ]);
    } catch (e) {
      console.log(`  page ${p}: ${(e as Error).message.slice(0, 80)}`);
      break;
    }
    console.log(`  page ${p+1}: ${page.data.length} txs`);

    // Batch-fetch events for these tx digests.
    for (const tx of page.data) {
      if (seen.has(tx.digest)) continue;
      seen.add(tx.digest);
      try {
        const detail = await rpc<TxResp>('sui_getTransactionBlock', [tx.digest, { showEvents: true }]);
        for (const evt of detail.events ?? []) {
          allEventTypes.set(evt.type, (allEventTypes.get(evt.type) || 0) + 1);
          if (/liquidat/i.test(evt.type) && !liquidationTypes.has(evt.type)) {
            liquidationTypes.set(evt.type, { sample: evt, txDigest: tx.digest });
          }
        }
      } catch (e) {
        if (/rate.?limit/i.test((e as Error).message)) await sleep(2000);
      }
      await sleep(150);
    }

    if (liquidationTypes.size > 0) {
      console.log(`  ✓ found liquidation events after ${seen.size} txs`);
      break;
    }
    if (!page.hasNextPage) break;
    cursor = page.nextCursor;
    await sleep(1000);
  }

  if (liquidationTypes.size === 0) {
    console.log(`  ⚠ no liquidation events in ${seen.size} txs scanned`);
    console.log(`  top 10 event types observed (FULL type, no truncation):`);
    [...allEventTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .forEach(([t, c]) => console.log(`    ${c}× ${t}`));
    return;
  }
  for (const [type, info] of liquidationTypes) {
    console.log(`\n  ✓ ${type}`);
    console.log(`    fields: ${Object.keys(info.sample.parsedJson).join(', ')}`);
    console.log(`    sample: ${JSON.stringify(info.sample.parsedJson).slice(0, 600)}`);
    console.log(`    in tx: ${info.txDigest}`);
  }
}

// CLI arg `--only=<label>` runs just one protocol. Lets us re-scan AlphaLend
// without re-walking Scallop / Bucket which we've already mapped.
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const onlyLabel = onlyArg ? onlyArg.slice('--only='.length).toLowerCase() : null;
const shouldRun = (label: string) => !onlyLabel || label.toLowerCase().includes(onlyLabel);

// AlphaLend's lending protocol object — well-documented, immutable.
if (shouldRun('AlphaLend')) {
  await findLiquidationsForProtocol(
    'AlphaLend',
    '0x01d9cf05d65fa3a9bb7163095139120e3c4e414dfbab153a49779a7d14010b93',
  );
  await sleep(2000);
}

// Scallop's main market object. Known from their SDK constants.
// (NOTE: their SDK uses `lendingMarket` object not the package address.)
if (shouldRun('Scallop')) {
  await findLiquidationsForProtocol(
    'Scallop (lending market)',
    '0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9',
  );
  await sleep(2000);
}

// Bucket V1 protocol object (BUCK CDP) — definitely active even with V2 launched.
if (shouldRun('Bucket')) {
  await findLiquidationsForProtocol(
    'Bucket V1',
    '0x9e3dab13212b27f5434416939db5dec6a319d15b89a84fd074d03ece6350d3df',
  );
}
