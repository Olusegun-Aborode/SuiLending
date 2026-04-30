// Probe each new protocol's package for liquidation events. We try a few
// likely event-type strings and report which ones return data + first event's
// parsedJson keys. Run: npx tsx scripts/discover-liq-events.mts
const RPC = process.env.BLOCKVISION_SUI_RPC ?? 'https://fullnode.mainnet.sui.io:443';

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result as T;
}

async function probe(label: string, eventType: string) {
  try {
    const page: any = await rpc('suix_queryEvents', [
      { MoveEventType: eventType }, null, 1, true,
    ]);
    const evt = page?.data?.[0];
    if (!evt) {
      console.log(`  ${label} → no events (type may not exist)`);
      return;
    }
    console.log(`  ${label} → ✓ found event`);
    console.log(`    timestampMs: ${evt.timestampMs}`);
    console.log(`    parsedJson keys: ${Object.keys(evt.parsedJson || {}).join(', ')}`);
    console.log(`    parsedJson sample:`, JSON.stringify(evt.parsedJson).slice(0, 500));
  } catch (e) {
    console.log(`  ${label} → error: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
  }
}

console.log('\n── Suilend ──');
const SUILEND_PKG = '0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf';
await probe('LiquidateEvent', `${SUILEND_PKG}::lending_market::LiquidateEvent`);
await probe('liquidate_event', `${SUILEND_PKG}::lending_market::liquidate_event`);

console.log('\n── Scallop ──');
const SCALLOP_PKG = '0xefe170ec0be4d762196bedecd7a065816576198a6527c99282a2551aaa7da38c';
await probe('LiquidateEvent (liquidate module)', `${SCALLOP_PKG}::liquidate::LiquidateEvent`);
await probe('LiquidateEvent (protocol)', `${SCALLOP_PKG}::protocol::LiquidateEvent`);

console.log('\n── AlphaLend ──');
const ALPHA_PKG = '0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4';
await probe('LiquidationEvent', `${ALPHA_PKG}::lending_protocol::LiquidationEvent`);
await probe('LiquidateEvent', `${ALPHA_PKG}::lending_protocol::LiquidateEvent`);

console.log('\n── Bucket V2 ──');
// Bucket V2 CDP package — try a few likely values
const BUCKET_PKGS = [
  '0xc63072e7f5f4983a2efaf5bdba1480d5e7d74d57948e1c7cc436f8e22cbeb410',
];
for (const pkg of BUCKET_PKGS) {
  await probe(`${pkg.slice(0,10)} LiquidateEvent`, `${pkg}::cdp::LiquidateEvent`);
  await probe(`${pkg.slice(0,10)} liquidate`, `${pkg}::cdp::liquidate_event`);
}
