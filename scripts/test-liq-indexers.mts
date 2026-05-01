/**
 * Smoke test for the 3 P0.3 liquidation indexers.
 *
 * Calls Sui RPC directly (bypassing the Scallop SDK that doesn't load under
 * raw tsx because of its package.json exports map) and runs each protocol's
 * parser logic against ONE live event. Validates field extraction, USD math,
 * and that we don't reject the event prematurely.
 *
 * Run:
 *   set -a && source .env.local && set +a && npx tsx scripts/test-liq-indexers.mts
 */

const RPC = process.env.BLOCKVISION_SUI_RPC ?? 'https://fullnode.mainnet.sui.io:443';

interface SuiEvent {
  id: { txDigest: string; eventSeq: string };
  type: string;
  parsedJson: Record<string, unknown>;
  timestampMs: string;
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

async function fetchOne(eventType: string): Promise<SuiEvent | null> {
  const page = await rpc<{ data: SuiEvent[] }>('suix_queryEvents', [
    { MoveEventType: eventType }, null, 1, true,
  ]);
  return page.data[0] ?? null;
}

// ─── Parsers (replicas of the adapter logic; kept simple) ───────────────────

function parseScallop(j: Record<string, unknown>) {
  const ev = j as {
    collateral_type?: { name?: string }; debt_type?: { name?: string };
    liq_amount?: string; liquidator?: string; obligation?: string;
    repay_on_behalf?: string;
    collateral_price?: { value?: string }; debt_price?: { value?: string };
  };
  const cType = '0x' + (ev.collateral_type?.name ?? '');
  const dType = '0x' + (ev.debt_type?.name ?? '');
  const collateralPrice = Number(ev.collateral_price?.value ?? '0') / 1e9;
  const debtPrice = Number(ev.debt_price?.value ?? '0') / 1e9;
  // Default 9 decimals for assets we haven't catalogued
  const collateralAmount = Number(ev.liq_amount ?? '0') / 1e9;
  const debtAmount = Number(ev.repay_on_behalf ?? '0') / 1e9;
  return {
    liquidator: (ev.liquidator ?? '').slice(0, 16) + '…',
    borrower: (ev.obligation ?? '').slice(0, 16) + '…',
    collateralAsset: cType.split('::').pop()?.toUpperCase() ?? '',
    collateralAmount, collateralPrice,
    collateralUsd: collateralAmount * collateralPrice,
    debtAsset: dType.split('::').pop()?.toUpperCase() ?? '',
    debtAmount, debtPrice,
    debtUsd: debtAmount * debtPrice,
  };
}

function parseAlphalend(j: Record<string, unknown>) {
  // events::Event<T> wrapper: parsedJson.event = { ... }
  const raw = j as { event?: Record<string, unknown> };
  const inner = (raw.event ?? raw) as {
    repay_type?: { name?: string }; withdraw_type?: { name?: string };
    repay_amount?: string; repay_value?: string;
    withdraw_amount?: string; withdraw_value?: string;
    position_id?: string;
  };
  const cType = '0x' + (inner.withdraw_type?.name ?? '');
  const dType = '0x' + (inner.repay_type?.name ?? '');
  const collateralUsd = Number(inner.withdraw_value ?? '0') / 1e9;
  const debtUsd = Number(inner.repay_value ?? '0') / 1e9;
  const collateralAmount = Number(inner.withdraw_amount ?? '0') / 1e9;
  const debtAmount = Number(inner.repay_amount ?? '0') / 1e9;
  return {
    borrower: (inner.position_id ?? '').slice(0, 16) + '…',
    collateralAsset: cType.split('::').pop()?.toUpperCase() ?? '',
    collateralAmount,
    collateralPrice: collateralAmount > 0 ? collateralUsd / collateralAmount : 0,
    collateralUsd,
    debtAsset: dType.split('::').pop()?.toUpperCase() ?? '',
    debtAmount,
    debtPrice: debtAmount > 0 ? debtUsd / debtAmount : 0,
    debtUsd,
  };
}

function parseBucketV1(j: Record<string, unknown>) {
  const ev = j as {
    collateral?: string; debt?: string; debtor?: string;
    precision?: string; price?: string;
  };
  const collateralAmount = Number(ev.collateral ?? '0') / 1e9;
  const debtAmount = Number(ev.debt ?? '0') / 1e9;
  const precision = Number(ev.precision ?? '1') || 1;
  const collateralPrice = Number(ev.price ?? '0') / precision;
  return {
    borrower: (ev.debtor ?? '').slice(0, 16) + '…',
    collateralAsset: 'V1',
    collateralAmount, collateralPrice,
    collateralUsd: collateralAmount * collateralPrice,
    debtAsset: 'BUCK',
    debtAmount, debtPrice: 1,
    debtUsd: debtAmount,
  };
}

// ─── Run ────────────────────────────────────────────────────────────────────

const PKG_ALPHALEND = '0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4';

const TARGETS: Array<{ label: string; type: string; parse: (j: Record<string, unknown>) => Record<string, unknown> }> = [
  {
    label: 'Scallop',
    type: '0x6e641f0dca8aedab3101d047e96439178f16301bf0b57fe8745086ff1195eb3e::liquidate::LiquidateEventV2',
    parse: parseScallop,
  },
  {
    label: 'AlphaLend',
    type: `${PKG_ALPHALEND}::events::Event<${PKG_ALPHALEND}::alpha_lending::LiquidationEvent>`,
    parse: parseAlphalend,
  },
  {
    label: 'Bucket V1',
    type: '0x601be98dc465539a872a7e27ea1b59d60e03b0081486ee64222fcd01ddd9ad40::liquidate::DebtorInfo',
    parse: parseBucketV1,
  },
];

for (const t of TARGETS) {
  console.log(`\n══ ${t.label} ══`);
  try {
    const evt = await fetchOne(t.type);
    if (!evt) { console.log('  (no events found)'); continue; }
    console.log(`  tx: ${evt.id.txDigest}`);
    console.log(`  raw fields: ${Object.keys(evt.parsedJson).join(', ')}`);
    const parsed = t.parse(evt.parsedJson);
    console.log(`  parsed: ${JSON.stringify(parsed, null, 2).split('\n').join('\n  ')}`);
  } catch (e) {
    console.log(`  ✗ ${(e as Error).message}`);
  }
  await new Promise(r => setTimeout(r, 1000));
}
