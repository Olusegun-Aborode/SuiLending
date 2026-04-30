/**
 * Dynamic NAVI pool registry.
 *
 * Source of truth for pool-id → {symbol, coinType, decimals, price} is the
 * NAVI open API. Cached in-memory with a short TTL so event indexers don't
 * hammer the endpoint.
 *
 * This replaces the hardcoded NAVI_POOL_ID_TO_SYMBOL / NAVI_ASSET_MAP tables
 * which drifted as NAVI added pools past id=7 and swapped the meaning of
 * ids 6 and 7. Always prefer this helper when parsing on-chain events.
 */

const NAVI_POOLS_API = 'https://open-api.naviprotocol.io/api/navi/pools';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface NaviPoolInfo {
  poolId: number;
  symbol: string;
  coinType: string;
  decimals: number;
  price: number;
}

interface ApiPool {
  id: number;
  token: { symbol: string; coinType: string; decimals: number; price?: number };
  oracle?: { price: number };
}
interface ApiResponse {
  code: number;
  data: ApiPool[];
}

let cache: { at: number; byId: Record<number, NaviPoolInfo> } | null = null;
let inflight: Promise<Record<number, NaviPoolInfo>> | null = null;

async function fetchRegistry(): Promise<Record<number, NaviPoolInfo>> {
  const res = await fetch(NAVI_POOLS_API, { cache: 'no-store' });
  if (!res.ok) throw new Error(`NAVI pools API ${res.status}`);
  const json = (await res.json()) as ApiResponse;
  if (json.code !== 0 || !Array.isArray(json.data)) {
    throw new Error('NAVI pools API: unexpected shape');
  }
  const byId: Record<number, NaviPoolInfo> = {};
  for (const p of json.data) {
    byId[p.id] = {
      poolId: p.id,
      symbol: p.token.symbol,
      coinType: p.token.coinType,
      decimals: p.token.decimals,
      price: p.token.price ?? p.oracle?.price ?? 0,
    };
  }
  return byId;
}

/**
 * Returns a pool-id → info map, cached for TTL_MS.
 * Concurrent callers share the in-flight fetch.
 */
export async function getNaviPoolRegistry(): Promise<Record<number, NaviPoolInfo>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.byId;

  if (!inflight) {
    inflight = fetchRegistry()
      .then((byId) => {
        cache = { at: Date.now(), byId };
        return byId;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Look up a single pool; returns null if unknown. */
export async function getNaviPool(poolId: number): Promise<NaviPoolInfo | null> {
  const reg = await getNaviPoolRegistry();
  return reg[poolId] ?? null;
}

/** Force-refresh the cache (e.g. if a new pool just appeared on-chain). */
export async function refreshNaviPoolRegistry(): Promise<void> {
  cache = null;
  await getNaviPoolRegistry();
}
