/**
 * Price fetching: DefiLlama primary, CoinGecko fallback.
 */

const DEFILLAMA_IDS: Record<string, string> = {
  SUI: 'coingecko:sui',
  USDC: 'coingecko:usd-coin',
  USDT: 'coingecko:tether',
  WETH: 'coingecko:weth',
  CETUS: 'coingecko:cetus-protocol',
  vSUI: 'coingecko:volo-staked-sui',
  NAVX: 'coingecko:navi-protocol',
  haSUI: 'coingecko:haedal-staked-sui',
};

const COINGECKO_IDS: Record<string, string> = {
  SUI: 'sui',
  USDC: 'usd-coin',
  USDT: 'tether',
  WETH: 'weth',
  CETUS: 'cetus-protocol',
  vSUI: 'volo-staked-sui',
  NAVX: 'navi-protocol',
  haSUI: 'haedal-staked-sui',
};

export async function fetchPrices(): Promise<Record<string, number>> {
  // Try DefiLlama first
  try {
    const ids = Object.values(DEFILLAMA_IDS).join(',');
    const res = await fetch(
      `https://coins.llama.fi/prices/current/${ids}`,
      { next: { revalidate: 300 } }
    );
    if (res.ok) {
      const data = await res.json();
      const prices: Record<string, number> = {};
      for (const [symbol, llamaId] of Object.entries(DEFILLAMA_IDS)) {
        const coin = data.coins?.[llamaId];
        if (coin?.price) prices[symbol] = coin.price;
      }
      if (Object.keys(prices).length >= 4) return prices;
    }
  } catch {
    // fall through to CoinGecko
  }

  // Fallback: CoinGecko
  try {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { next: { revalidate: 300 } }
    );
    if (res.ok) {
      const data = await res.json();
      const prices: Record<string, number> = {};
      for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
        if (data[geckoId]?.usd) prices[symbol] = data[geckoId].usd;
      }
      return prices;
    }
  } catch {
    // return empty
  }

  return {};
}

/** Fetch single asset price */
export async function fetchPrice(symbol: string): Promise<number | null> {
  const prices = await fetchPrices();
  return prices[symbol] ?? null;
}

/**
 * Price Scallop sCoins (interest-bearing receipt tokens issued by Scallop
 * pools). sCoins represent shares in a Scallop pool and don't have direct
 * oracle quotes — DefiLlama's `/coins` API returns nothing for them.
 *
 *   sCoinPrice = underlyingPrice × conversionRate
 *
 * `conversionRate` is "underlying coin per 1 sCoin" and grows over time as
 * pool interest accrues. Both fields come from `ScallopIndexer.getMarket()`,
 * which is HTTP-cached on Scallop's side.
 *
 * Used by the Bucket adapter: many V1 buckets and V2 vaults hold sCoins as
 * collateral (e.g. SCALLOP_USDC, SCALLOP_DEEP, SCALLOP_WAL) — pricing them
 * recovers a chunk of TVL that was previously zero in our on-chain math.
 *
 * Returns a map of `sCoinType → priceUsd`. sCoins whose underlying we can't
 * find an oracle price for are simply absent from the returned map.
 */
export async function fetchScallopSCoinPrices(): Promise<Record<string, number>> {
  try {
    const { ScallopIndexer } = await import('@scallop-io/sui-scallop-sdk');
    const indexerUrl = process.env.SCALLOP_INDEXER_URL ?? 'https://sdk.api.scallop.io';
    const indexer = new ScallopIndexer({ indexerApiUrl: indexerUrl });
    const market = await indexer.getMarket();

    const out: Record<string, number> = {};
    for (const pool of Object.values(market.pools ?? {})) {
      // We need: sCoinType (key), underlying price (from pool.coinPrice), and
      // conversionRate. Some isolated pools may not expose sCoinType — skip
      // those gracefully rather than throwing.
      const p = pool as { sCoinType?: string; coinPrice?: number; conversionRate?: number };
      if (!p.sCoinType || !p.coinPrice || p.coinPrice <= 0) continue;
      const rate = p.conversionRate && p.conversionRate > 0 ? p.conversionRate : 1;
      out[p.sCoinType] = p.coinPrice * rate;
    }
    return out;
  } catch (e) {
    // sCoin pricing is best-effort — if Scallop's indexer is down, the
    // Bucket adapter just won't price sCoin collateral this cycle.
    console.warn('[prices.fetchScallopSCoinPrices]', e instanceof Error ? e.message : e);
    return {};
  }
}

/**
 * Fetch USD prices for Sui assets keyed by full coinType. Uses DefiLlama's
 * `sui:<coinType>` price endpoint, which covers anything indexed on the Sui
 * network — including LSTs that aren't on CoinGecko by symbol slug.
 *
 * Returns a map of `coinType → priceUsd`. Missing tokens are simply absent
 * from the returned object.
 */
export async function fetchSuiCoinPrices(
  coinTypes: string[],
): Promise<Record<string, number>> {
  if (coinTypes.length === 0) return {};
  try {
    const ids = coinTypes.map((c) => `sui:${c}`).join(',');
    const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const out: Record<string, number> = {};
    for (const c of coinTypes) {
      const coin = data.coins?.[`sui:${c}`];
      if (coin?.price) out[c] = coin.price;
    }
    return out;
  } catch {
    return {};
  }
}
