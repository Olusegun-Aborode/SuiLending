// Live data loader for the Sui Lending Dashboard.
//
// Backend is now same-origin (the Next.js API routes in this repo serve
// from `/api/sui-lending`). No CORS to deal with. The HTML pages await
// `window.DATA_READY` before mounting React.

const DEFAULT_API =
  (typeof window !== 'undefined' && window.SUI_LENDING_API_URL) ||
  // Same-origin path served by the Next.js app in `src/app/api/sui-lending`.
  '/api/sui-lending';

/**
 * Returns a fully-shaped data object that matches SCHEMA.js. Throws on
 * fetch/parse failure so the boot-splash error path can render.
 */
async function loadSuiLendingData() {
  const res = await fetch(DEFAULT_API, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${DEFAULT_API}`);
  const data = await res.json();

  // Defensive defaults — the backend may add fields over time.
  data.protocols     = data.protocols     ?? [];
  data.pools         = data.pools         ?? [];
  data.vaults        = data.vaults        ?? [];
  data.tvlSeries     = data.tvlSeries     ?? [];
  data.tvlMetricSeries = data.tvlMetricSeries ?? { tvl: [], supply: [], borrow: [], revenue: [] };
  data.volumeSeries  = data.volumeSeries  ?? [];
  data.protocolMetrics = data.protocolMetrics ?? [];
  data.kpiSparks     = data.kpiSparks     ?? { tvl: [], supply: [], borrow: [], revenue: [], users: [], liq: [] };
  data.heatmapMetrics= data.heatmapMetrics?? { tx: [], volume: [], liquid: [] };
  data.liquidations  = data.liquidations  ?? [];
  data.liquidationSeries = data.liquidationSeries ?? [];
  data.ticker        = data.ticker        ?? [];
  data.days          = data.days          ?? 90;
  return data;
}

// Boot promise — resolves with the loaded data; rejects on error. Each HTML
// page awaits this before calling ReactDOM.render(). On failure we leave a
// visible message in the boot-splash and rethrow so the page doesn't render
// with broken data.
window.DATA_READY = loadSuiLendingData()
  .then((data) => {
    window.SUI_LENDING_DATA = data;
    return data;
  })
  .catch((err) => {
    console.error('[sui-lending] failed to load data:', err);
    // Leave boot-splash in place with a status message
    const status = document.querySelector('.bs-status');
    if (status) status.textContent = `data fetch failed: ${err.message}`;
    throw err;
  });
