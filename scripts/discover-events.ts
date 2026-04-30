/**
 * Discover NAVI event types available on-chain.
 *
 * Usage: npx tsx scripts/discover-events.ts
 *
 * Requires ALCHEMY_SUI_RPC env var (or uses public RPC).
 */

const RPC_URL = process.env.ALCHEMY_SUI_RPC ?? 'https://fullnode.mainnet.sui.io:443';

const NAVI_PACKAGE =
  '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb';

const EVENT_TYPES = [
  'DepositEvent',
  'WithdrawEvent',
  'BorrowEvent',
  'RepayEvent',
  'LiquidationCallEvent',
  'LiquidationEvent',
  'StateUpdated',
];

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}

async function main() {
  console.log('Discovering NAVI event types...\n');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Package: ${NAVI_PACKAGE}\n`);

  for (const eventName of EVENT_TYPES) {
    const fullType = `${NAVI_PACKAGE}::event::${eventName}`;
    console.log(`--- ${eventName} ---`);
    console.log(`Type: ${fullType}`);

    try {
      const result = await rpc('suix_queryEvents', [
        { MoveEventType: fullType },
        null,
        1,
        true, // descending
      ]);

      if (result.result?.data?.length > 0) {
        const evt = result.result.data[0];
        console.log('Fields:', JSON.stringify(evt.parsedJson, null, 2));
        console.log(`Timestamp: ${new Date(Number(evt.timestampMs)).toISOString()}`);
      } else {
        console.log('No events found');
      }
    } catch (err) {
      console.log('Error:', err);
    }
    console.log('');
  }
}

main().catch(console.error);
