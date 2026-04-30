# Deploy — sui-lending-dashboard (static frontend)

This is a static HTML+JSX dashboard that fetches its data from
**navi-dashboard's `/api/sui-lending` endpoint**. It needs:

1. The navi-dashboard backend deployed (see that repo's `DEPLOY.md`)
2. A separate Vercel static deployment for these HTML files

## One-time setup

### 1. Initialize git (if not already)

```sh
cd "<this folder>"
git init
git add -A
git commit -m "Initial scaffold of sui-lending-dashboard"
```

### 2. Point `data.js` at the live API

Edit `data.js`, change the `DEFAULT_API` line:

```js
const DEFAULT_API =
  (typeof window !== 'undefined' && window.SUI_LENDING_API_URL) ||
  'https://<your-navi-dashboard-deploy>.vercel.app/api/sui-lending'; // ← change me
```

(Optional) Override per-environment by inlining a `<script>` tag BEFORE
`data.js` in each HTML page:

```html
<script>window.SUI_LENDING_API_URL = "https://navi-dashboard-staging.vercel.app/api/sui-lending";</script>
<script src="data.js"></script>
```

### 3. Deploy on Vercel

```sh
# Connect Vercel (one-time)
vercel link

# Deploy
vercel deploy --prod
```

There's no build step — Vercel just serves the HTML/JS/CSS as-is.

## Post-deploy verification

Open `https://<your-static-deploy>.vercel.app/Overview.html`. You should see:

- Boot splash for ~3s while data fetches
- KPI strip with real numbers (TVL, Supply, Borrow, Liquidations)
- TVL by Protocol chart populated with 90 days of data
- Daily Flows chart with stacked supply/borrow/liquid bars
- All 5 protocols visible in dropdowns

If the boot splash sticks at "data fetch failed: …", check the browser
console — most likely a CORS issue or wrong API URL. Verify with:

```sh
curl -i -X OPTIONS \
  -H "Origin: https://<static-deploy>.vercel.app" \
  https://<navi-dashboard>.vercel.app/api/sui-lending
```

Should return `HTTP 204` with `Access-Control-Allow-Origin: *`.

## Architecture

```
┌──────────────────────────────────┐    1.4MB JSON         ┌──────────────────────────┐
│ sui-lending-dashboard (static)   │────────────────────→  │ navi-dashboard (Next.js) │
│  · Overview.html                 │   /api/sui-lending    │  · /api/sui-lending      │
│  · Protocol.html                 │       (CORS *)        │  · /api/<proto>/cron/*   │
│  · Rates.html                    │                       │                          │
│  · Revenue.html                  │                       │  postgres (Neon)         │
│  · Collateral.html               │                       │   · PoolSnapshot         │
│  · Liquidation.html              │                       │   · PoolDaily            │
│  · MarketDetail.html             │                       │   · LiquidationEvent     │
│                                  │                       │   · RateModelParams      │
│  data.js → fetch ──┐             │                       │   · CollateralBorrowPair │
│                    │             │                       │   · WalletPosition       │
└────────────────────┼─────────────┘                       └──────────────────────────┘
                     │
                     v
              window.SUI_LENDING_DATA
              window.DATA_READY (Promise)
```

## What changed since the mock-data scaffold

- `data.js` now fetches from a live endpoint (was: seeded mock generator)
- Each HTML page wraps `ReactDOM.render(...)` in `window.DATA_READY.then(...)`
- `pages.jsx` accesses data via `Proxy` so `D.protocols.map(...)` works
  whether the underlying data was sync (mock) or arrived async (fetch)

To revert to mock data for offline development, restore the original
`data.js` from git history (or copy from
`Datum Labs Dashboard SDK/data.js` and adapt).
