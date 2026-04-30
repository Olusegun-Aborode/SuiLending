/**
 * Alchemy-backed Sui JSON-RPC client.
 *
 * Reads ALCHEMY_SUI_RPC from env. Falls back to public Sui mainnet RPC.
 */

const RPC_URL =
  process.env.ALCHEMY_SUI_RPC ?? 'https://fullnode.mainnet.sui.io:443';

let requestId = 0;

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  requestId += 1;
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`RPC ${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

// ─── Typed wrappers ─────────────────────────────────────────────────────────

export interface EventPage {
  data: Array<{
    id: { txDigest: string; eventSeq: string };
    packageId: string;
    transactionModule: string;
    sender: string;
    type: string;
    parsedJson: Record<string, unknown>;
    timestampMs: string;
  }>;
  nextCursor: { txDigest: string; eventSeq: string } | null;
  hasNextPage: boolean;
}

export async function queryEvents(
  eventType: string,
  cursor?: { txDigest: string; eventSeq: string } | null,
  limit = 50,
  order: 'ascending' | 'descending' = 'descending'
): Promise<EventPage> {
  return rpc<EventPage>('suix_queryEvents', [
    { MoveEventType: eventType },
    cursor ?? null,
    limit,
    order === 'descending',
  ]);
}

export interface SuiObject {
  data: {
    objectId: string;
    version: string;
    content: {
      dataType: string;
      type: string;
      fields: Record<string, unknown>;
    };
  };
}

export async function getObject(objectId: string): Promise<SuiObject> {
  return rpc<SuiObject>('sui_getObject', [
    objectId,
    { showContent: true, showType: true },
  ]);
}

export async function getMultipleObjects(
  objectIds: string[]
): Promise<SuiObject[]> {
  return rpc<SuiObject[]>('sui_multiGetObjects', [
    objectIds,
    { showContent: true, showType: true },
  ]);
}

export interface DynamicFieldPage {
  data: Array<{
    name: { type: string; value: unknown };
    objectId: string;
    objectType: string;
  }>;
  nextCursor: string | null;
  hasNextPage: boolean;
}

export async function getDynamicFields(
  parentId: string,
  cursor?: string | null,
  limit = 50
): Promise<DynamicFieldPage> {
  return rpc<DynamicFieldPage>('suix_getDynamicFields', [
    parentId,
    cursor ?? null,
    limit,
  ]);
}

export { rpc };
