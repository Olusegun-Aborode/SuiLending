const RPC = process.env.BLOCKVISION_SUI_RPC ?? 'https://fullnode.mainnet.sui.io:443';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

interface SuiEvent { id: { txDigest: string; eventSeq: string }; type: string; parsedJson: Record<string, unknown>; timestampMs: string; }

/** Probe MoveEventModule for a package+module pair. */
async function probe(label: string, packageId: string, mod: string) {
  try {
    const filter = { MoveEventModule: { package: packageId, module: mod } };
    const r = await rpc<{ data: SuiEvent[] }>('suix_queryEvents', [filter, null, 5, true]);
    const events = r.data ?? [];
    if (events.length === 0) {
      console.log(`  ${label}::${mod} → 0 events`);
      return;
    }
    const liq = events.filter(e => /liquidat/i.test(e.type));
    console.log(`  ${label}::${mod} → ${events.length} events, ${liq.length} liquidation-like`);
    for (const e of liq.slice(0, 1)) {
      console.log(`    ✓ TYPE: ${e.type}`);
      console.log(`      fields: ${Object.keys(e.parsedJson).join(', ')}`);
      console.log(`      sample: ${JSON.stringify(e.parsedJson).slice(0, 350)}`);
    }
    // Even if no "liquidat", show distinct types in this module
    if (liq.length === 0) {
      const types = [...new Set(events.map(e => e.type))];
      types.slice(0, 3).forEach(t => console.log(`    type: ${t.slice(0, 100)}`));
    }
  } catch (e) {
    console.log(`  ${label}::${mod} → err: ${(e as Error).message.slice(0, 70)}`);
  }
}

console.log('\n══ SCALLOP ══');
const SCALLOP = '0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c';
for (const mod of ['liquidate', 'protocol', 'borrow', 'deposit', 'mint', 'redeem']) {
  await probe('Scallop', SCALLOP, mod);
  await sleep(2000);
}

console.log('\n══ ALPHALEND (first package) ══');
const ALPHA = '0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4';
for (const mod of ['lending_protocol', 'position', 'liquidate']) {
  await probe('AlphaLend', ALPHA, mod);
  await sleep(2000);
}

console.log('\n══ BUCKET V2 ══');
const BUCKET = '0xc63072e7f5f4983a2efaf5bdba1480d5e7d74d57948e1c7cc436f8e22cbeb410';
for (const mod of ['cdp', 'vault', 'liquidate', 'buck']) {
  await probe('Bucket', BUCKET, mod);
  await sleep(2000);
}
