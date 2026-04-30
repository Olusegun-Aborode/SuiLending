// Live data loader for the Sui Lending Dashboard.
//
// Two design rules:
//   1. window.DATA_READY ALWAYS resolves — never rejects. If the fetch
//      fails, we resolve with an empty-but-valid SCHEMA shape so the
//      dashboard chrome renders normally and the user sees a clear error
//      banner instead of a frozen boot-splash.
//   2. cache: 'no-store' on every fetch — Vercel's CDN cache is fine for
//      the JSON itself (60s s-maxage), but we don't want the BROWSER to
//      cache a transient 500 and then keep replaying it.

const DEFAULT_API =
  (typeof window !== 'undefined' && window.SUI_LENDING_API_URL) ||
  '/api/sui-lending';

// Empty SCHEMA shape — the React components handle these gracefully.
const EMPTY_DATA = {
  protocols: [],
  pools: [],
  vaults: [],
  tvlSeries: [],
  tvlMetricSeries: { tvl: [], supply: [], borrow: [], revenue: [] },
  volumeSeries: [],
  protocolMetrics: [],
  kpiSparks: { tvl: [], supply: [], borrow: [], revenue: [], users: [], liq: [] },
  liquidations: [],
  liquidationSeries: [],
  ticker: [],
  days: 90,
};

function applyDefaults(data) {
  for (const key of Object.keys(EMPTY_DATA)) {
    if (data[key] == null) data[key] = EMPTY_DATA[key];
  }
  return data;
}

async function loadSuiLendingData() {
  try {
    const res = await fetch(DEFAULT_API, {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`API returned HTTP ${res.status}`);
    }
    const data = await res.json();
    return { ok: true, data: applyDefaults(data) };
  } catch (err) {
    console.error('[sui-lending] data fetch failed:', err);
    return { ok: false, data: applyDefaults({ ...EMPTY_DATA }), error: err.message };
  }
}

// Single boot promise — resolves (never rejects) so the mount script doesn't
// have to worry about error handling. The dashboard renders either way; if
// `window.SUI_LENDING_DATA_ERROR` is set, pages.jsx shows a banner.
window.DATA_READY = loadSuiLendingData().then(({ ok, data, error }) => {
  window.SUI_LENDING_DATA = data;
  window.SUI_LENDING_DATA_ERROR = ok ? null : error;
  return data;
});

// Expose a manual retry helper — pages.jsx can call this from a "Retry"
// button in the error banner.
window.retrySuiLendingData = async function () {
  const result = await loadSuiLendingData();
  window.SUI_LENDING_DATA = result.data;
  window.SUI_LENDING_DATA_ERROR = result.ok ? null : result.error;
  // Force a soft remount via a custom event the pages can listen for.
  window.dispatchEvent(new CustomEvent('sui-lending-data-updated'));
  return result.ok;
};
