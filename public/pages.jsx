// Page bodies for the Sui Lending dashboard.
// Each Page<Name>() component is mounted by its corresponding HTML file.
// Each chart panel exposes its own controls via <ChartPanel>:
//   • protocol selector (single or multi)
//   • data/metric selector
//   • snapshot (PNG) button
//   • expand button (opens ExpandModal)

const { useState: useStateP, useEffect: useEffectP, useMemo: useMemoP, useRef: useRefP } = React;

// `window.SUI_LENDING_DATA` is populated asynchronously by data.js. To
// support both the synchronous mock-data flow and the live-fetch flow, D is a
// Proxy that resolves property access against the LATEST window value at call
// time — not at script-load time. By the time any React component renders,
// DATA_READY has resolved and the data is present.
const D = new Proxy({}, {
  get(_t, key) {
    const data = window.SUI_LENDING_DATA;
    if (!data) return undefined;
    return data[key];
  },
});

// ── Helpers ─────────────────────────────────────────────────────
const PROTO = new Proxy({}, {
  get(_t, key) {
    const protos = (window.SUI_LENDING_DATA?.protocols) ?? [];
    return protos.find(p => p.id === key);
  },
});

const ALL_PROTO_IDS = new Proxy([], {
  get(_t, key) {
    const arr = (window.SUI_LENDING_DATA?.protocols ?? []).map(p => p.id);
    if (key === 'length') return arr.length;
    if (key === 'includes' || key === 'indexOf' || key === 'map' ||
        key === 'filter' || key === 'forEach' || key === Symbol.iterator) {
      // Array methods — bind to the materialized array
      return arr[key].bind(arr);
    }
    return arr[key];
  },
});

function PageShell({ pageId, title, terminal, headerRight, children }) {
  const [theme, setTheme] = useStateP(document.body.getAttribute('data-theme') || 'light');
  const [cmdk, setCmdk] = useStateP(false);
  const [, forceRerender] = useStateP(0);

  useEffectP(() => {
    document.body.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch(e) {}
  }, [theme]);

  useEffectP(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdk(v => !v); }
      if (e.key === 'Escape') setCmdk(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Re-render silently if data.js auto-retries (never visible to the user).
  useEffectP(() => {
    const onUpdate = () => forceRerender(n => n + 1);
    window.addEventListener('sui-lending-data-updated', onUpdate);
    return () => window.removeEventListener('sui-lending-data-updated', onUpdate);
  }, []);

  // Defensive: D properties might be empty/undefined if the fetch failed.
  // The dashboard renders a clean "0/$0" state in that case — no error UI.
  const protoCount  = (D.protocols || []).length;
  const marketCount = ((D.pools || []).length) + ((D.vaults || []).length);

  return (
    <>
      <Topbar title={terminal} onOpenCmdk={() => setCmdk(true)} theme={theme} setTheme={setTheme} />
      <Sidebar current={pageId} />
      <main className="main">
        <div className="page-header">
          <div>
            <h1 className="page-title">{title}</h1>
            <div className="page-subtitle">
              <span className="ok">●</span> Sui mainnet · {protoCount} protocols · {marketCount} markets · updated 2s ago
            </div>
          </div>
          {headerRight && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{headerRight}</div>}
        </div>
        <Ticker items={D.ticker || []} />
        {children}
        <div style={{ height: 40 }} />
      </main>
      <StatusBar />
      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} protocols={D.protocols || []} pools={D.pools || []} />
    </>
  );
}

function KpiStrip({ items }) {
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="grid grid-4" style={{ gap: 0 }}>
        {items.map(k => (
          <div key={k.id} className="metric">
            <div className="metric-label">
              {k.label}
              {/* Optional methodology footnote — surfaces as a hover ⓘ next
                  to the KPI label when the headline number comes from a
                  source other than the protocol's own UI. Reuses the
                  info-icon pattern from chart panel headers. */}
              {k.note && (
                <span className="info-icon" tabIndex={0} aria-label={k.note} style={{ marginLeft: 6, width: 13, height: 13 }}>
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6.5" />
                    <line x1="8" y1="7" x2="8" y2="11.5" />
                    <circle cx="8" cy="4.8" r="0.4" fill="currentColor" />
                  </svg>
                  <span className="info-tip" role="tooltip">{k.note}</span>
                </span>
              )}
            </div>
            <div className="metric-value">{k.value}</div>
            <div className="metric-footer">
              <span className={`delta ${k.change >= 0 ? 'up' : 'down'}`}>
                {k.change >= 0 ? '▲' : '▼'} {Math.abs(k.change).toFixed(2)}%
              </span>
              <span>{k.subLabel || 'vs prev 30D'}</span>
            </div>
            {k.spark && (
              <div className="metric-spark">
                <Sparkline values={k.spark} color={k.change >= 0 ? 'var(--green)' : 'var(--red)'} width={200} height={36} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskChip({ risk }) {
  const c = risk === 'safe' ? 'var(--green)' : risk === 'moderate' ? '#D97706' : 'var(--red)';
  return <span style={{ color: c, fontFamily: 'var(--font-mono)', fontSize: 11 }}>● {risk}</span>;
}

function ProtocolChip({ id }) {
  const p = PROTO[id];
  if (!p) return <span>{id}</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
      <span style={{ width: 8, height: 8, background: p.color, borderRadius: 2 }} />
      {p.name}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// ChartPanel — wraps a chart with protocol/metric dropdowns + actions
// ────────────────────────────────────────────────────────────────
//   protocolMode:   'single' (incl. an "All" option) | 'multi' | 'none'
//   metricItems:    optional [{ id, label, short? }]
//   timeframes:     optional [7, 30, 90] (or any integer day-count list).
//                   When provided, renders a small segmented toggle and the
//                   render callback receives `timeframe` (in days).
//   defaultTimeframe: which entry of `timeframes` to start on. Defaults to
//                   the LAST one (i.e. the longest window) so the chart
//                   shows the most context out of the box.
//   caption:        optional one-line description rendered inline next to
//                   the title (always visible — good for very short labels).
//   description:    optional richer explanation surfaced via a hover ⓘ icon.
//                   Use this for "what does this chart do" copy where the
//                   title alone is ambiguous (treemaps, composite metrics).
//                   Pure CSS hover, no state — keeps the panel header light.
//   className:      'col-4' | 'col-6' | 'col-8' | etc — for grid layout
//   render({ proto, metric, size, timeframe }):  size is 'normal'|'expanded'
// ────────────────────────────────────────────────────────────────
function ChartPanel({
  title,                      // string OR ({ proto, metric }) => string
  protocolMode = 'single',
  defaultProto,
  metricItems,
  defaultMetric,
  timeframes,
  defaultTimeframe,
  caption,
  description,
  className = '',
  render,
}) {
  const initialProto = defaultProto != null
    ? defaultProto
    : (protocolMode === 'multi' ? ALL_PROTO_IDS : 'all');
  const [proto, setProto]   = useStateP(initialProto);
  const [metric, setMetric] = useStateP(defaultMetric ?? metricItems?.[0]?.id);
  // Pick a default timeframe — last in the list (longest window) when not
  // specified. Stored even when `timeframes` is undefined so the render
  // callback can default-spread it cleanly.
  const initialTf = defaultTimeframe ?? (timeframes ? timeframes[timeframes.length - 1] : null);
  const [timeframe, setTimeframe] = useStateP(initialTf);
  const [expanded, setExpanded] = useStateP(false);
  const ref = useRefP(null);

  const protoItemsSingle = [
    { id: 'all', label: 'All protocols', swatch: 'var(--fg-muted)' },
    ...D.protocols.map(p => ({ id: p.id, label: p.name, swatch: p.color })),
  ];
  const protoItemsMulti = D.protocols.map(p => ({ id: p.id, label: p.name, swatch: p.color }));

  const resolvedTitle = typeof title === 'function' ? title({ proto, metric }) : title;

  return (
    <>
      <div className={`panel ${className}`} ref={ref}>
        <div className="panel-header">
          <span className="panel-title">
            <span className="bullet">●</span> {resolvedTitle}
            {description && (
              <span className="info-icon" tabIndex={0} aria-label={description}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="6.5" />
                  <line x1="8" y1="7" x2="8" y2="11.5" />
                  <circle cx="8" cy="4.8" r="0.4" fill="currentColor" />
                </svg>
                <span className="info-tip" role="tooltip">{description}</span>
              </span>
            )}
            {caption && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: 'var(--fg-muted)', textTransform: 'none', letterSpacing: 0 }}>{caption}</span>}
          </span>
          <div className="chart-tools" data-snapshot-skip="true">
            {timeframes && (
              <div className="timeframe-toggle" role="tablist" aria-label="Timeframe">
                {timeframes.map(tf => (
                  <button key={tf} role="tab"
                    className={timeframe === tf ? 'active' : ''}
                    aria-selected={timeframe === tf}
                    onClick={() => setTimeframe(tf)}
                    title={`Last ${tf} days`}>
                    {tf}D
                  </button>
                ))}
              </div>
            )}
            {metricItems && (
              <Dropdown label="Data" value={metric} items={metricItems} onChange={setMetric} />
            )}
            {protocolMode === 'single' && (
              <Dropdown label="Protocol" value={proto} items={protoItemsSingle} onChange={setProto} />
            )}
            {protocolMode === 'multi' && (
              <Dropdown label="Protocol" multi selected={proto} items={protoItemsMulti} onChange={setProto} />
            )}
            <button className="icon-btn" title="Snapshot to PNG"
              onClick={() => snapshotPanel(ref.current, `${resolvedTitle.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}.png`)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>
            </button>
            <button className="icon-btn" title="Expand" onClick={() => setExpanded(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10V4h6M20 14v6h-6M20 10V4h-6M4 14v6h6"/></svg>
            </button>
          </div>
        </div>
        <div className="panel-body">{render({ proto, metric, size: 'normal', timeframe })}</div>
      </div>
      <ExpandModal open={expanded} onClose={() => setExpanded(false)} title={resolvedTitle}>
        {render({ proto, metric, size: 'expanded', timeframe })}
      </ExpandModal>
    </>
  );
}

// Navigate to the Market Detail sub-page
function goToMarket(protocol, market) {
  if (typeof showNavSplash === 'function') showNavSplash();
  window.location.href = `MarketDetail.html?protocol=${protocol}&market=${encodeURIComponent(market)}`;
}

// Token price helper — derived from the ticker; used to render token amounts
const TOKEN_PRICE = {
  SUI: 3.18, USDC: 1.0001, USDT: 0.9998, WETH: 3842.12, WBTC: 67921.4,
  vSUI: 3.42, sSUI: 3.30, afSUI: 3.40, haSUI: 3.38, CETUS: 0.142,
  NAVX: 0.084, SCA: 0.062,
};
const priceOf = (sym) => TOKEN_PRICE[sym] ?? 1;

// Filter helpers
const matchProto = (row, proto) => proto === 'all' || row.protocol === proto;
const inProtoSet = (row, set) => Array.isArray(set) ? set.includes(row.protocol) : true;

// ════════════════════════════════════════════════════════════════
// PAGE 1 — Overview
// ════════════════════════════════════════════════════════════════
function PageOverview() {
  const totalTvl = D.protocolMetrics.reduce((s, p) => s + p.tvl, 0);
  const totalSupply = D.protocolMetrics.reduce((s, p) => s + p.supply, 0);
  const totalBorrow = D.protocolMetrics.reduce((s, p) => s + p.borrow, 0);
  const liq30d = D.liquidations.length;

  return (
    <PageShell pageId="overview" title="Lending Terminal: SUI — Overview" terminal="lending-terminal-sui-overview">
      <KpiStrip items={[
        { id: 'tvl',    label: 'Total Value Locked', value: fmtUSD(totalTvl * 1e6, 1), change: 4.82, spark: D.kpiSparks.tvl.slice(-30) },
        { id: 'supply', label: 'Total Supplied',     value: fmtUSD(totalSupply * 1e6, 1), change: 5.10, spark: D.kpiSparks.supply.slice(-30) },
        { id: 'borrow', label: 'Total Borrowed',     value: fmtUSD(totalBorrow * 1e6, 1), change: 3.42, spark: D.kpiSparks.borrow.slice(-30) },
        { id: 'liq',    label: 'Liquidations (30D)', value: fmtNum(liq30d, 0), change: -2.1, subLabel: 'count', spark: D.kpiSparks.liq.slice(-30) },
      ]} />

      <div className="grid grid-12" style={{ marginTop: 16 }}>
        <ChartPanel
          title="TVL by Protocol"
          className="col-8"
          protocolMode="multi"
          description="Stacked time series of total value locked across the selected protocols. Switch the Data dropdown to see Supplied, Borrowed, or Revenue instead. Use the timeframe toggle to zoom between 7, 30, and 90 days."
          metricItems={[
            { id: 'tvl',     label: 'TVL' },
            { id: 'supply',  label: 'Supplied' },
            { id: 'borrow',  label: 'Borrowed' },
            { id: 'revenue', label: 'Revenue' },
          ]}
          timeframes={[7, 30, 90]}
          render={({ proto, metric, size, timeframe }) => {
            const w = size === 'expanded' ? 1200 : 820;
            const h = size === 'expanded' ? 560 : 320;
            const src = D.tvlMetricSeries[metric] || D.tvlSeries;
            // Slice each per-protocol series to the active timeframe window.
            // Source series carry 90 days, so 7/30/90 always have data.
            const series = D.protocols
              .filter(p => proto.includes(p.id))
              .map(p => ({
                name: p.name, color: p.color,
                values: src[D.protocols.indexOf(p)].slice(-timeframe).map(x => x.value),
              }));
            return <AreaChart series={series} stacked width={w} height={h} formatter={fmtUSD} valueSuffix="M" />;
          }}
        />

        <ChartPanel
          title="Protocol Mix"
          className="col-4"
          protocolMode="none"
          description="Treemap of each protocol's share of today's total. Tile area is proportional to the protocol's value for the chosen metric — switch between TVL, Supplied, and Borrowed to see how the mix shifts. Hover any tile for exact value and percentage share."
          metricItems={[
            { id: 'tvl',    label: 'By TVL' },
            { id: 'supply', label: 'By Supplied' },
            { id: 'borrow', label: 'By Borrowed' },
          ]}
          render={({ metric, size }) => {
            const w = size === 'expanded' ? 1200 : 360;
            const h = size === 'expanded' ? 560 : 300;
            // Pass through tvlNote so the Treemap tooltip can surface the
            // methodology footnote when a protocol's headline differs from
            // its own UI (currently only Bucket).
            const items = D.protocols.map(p => {
              const m = D.protocolMetrics.find(x => x.id === p.id);
              return {
                id: p.id, name: p.name,
                value: m[metric] || m.tvl, color: p.color,
                note: metric === 'tvl' ? m.tvlNote : null,
              };
            });
            const valueLabel = metric === 'tvl' ? 'TVL' : metric === 'supply' ? 'Supplied' : 'Borrowed';
            return <Treemap items={items} width={w} height={h} valueLabel={valueLabel} />;
          }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Daily Flows"
          protocolMode="none"
          description="Daily $-volume of supply deposits, borrow draws, and liquidation repayments aggregated across all 5 protocols. Stacked bars show the mix on each day; the tooltip's TOTAL line tells you total daily activity. Filter to a single flow type via the Data dropdown."
          metricItems={[
            { id: 'all',     label: 'All flows' },
            { id: 'supply',  label: 'Supply only' },
            { id: 'borrow',  label: 'Borrow only' },
            { id: 'liquid',  label: 'Liquidations only' },
          ]}
          defaultMetric="all"
          timeframes={[7, 30, 90]}
          render={({ metric, size, timeframe }) => {
            const w = size === 'expanded' ? 1200 : 1200;
            const h = size === 'expanded' ? 520 : 240;
            const keys = metric === 'all' ? ['supply','borrow','liquid'] : [metric];
            const colors = metric === 'all'
              ? ['#FF6B35', '#3B5FE0', '#D6322E']
              : [metric === 'supply' ? '#FF6B35' : metric === 'borrow' ? '#3B5FE0' : '#D6322E'];
            // volumeSeries carries 90 daily rows; slice tail by the active window.
            const sliced = D.volumeSeries.slice(-timeframe);
            return <StackedBarChart data={sliced} keys={keys} colors={colors} width={w} height={h} formatter={v => `$${v.toFixed(1)}M`} />;
          }}
        />
      </div>
    </PageShell>
  );
}

// ════════════════════════════════════════════════════════════════
// PAGE 2 — Protocol (one protocol focus, switchable in header)
// ════════════════════════════════════════════════════════════════
function PageProtocol() {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('protocol') || 'navi';
  const [active, setActive] = useStateP(initial);
  const proto = PROTO[active];
  const metrics = D.protocolMetrics.find(m => m.id === active);
  const isPool = proto.archetype === 'pool';
  const protoMarkets = isPool
    ? D.pools.filter(p => p.protocol === active)
    : D.vaults.filter(v => v.protocol === active);

  const tvlIdx = D.protocols.findIndex(p => p.id === active);

  const headerSwitcher = (
    <Dropdown
      label="Protocol"
      value={active}
      items={D.protocols.map(p => ({ id: p.id, label: `${p.name} (${p.archetype})`, swatch: p.color }))}
      onChange={(id) => {
        setActive(id);
        // keep URL in sync so reload / share preserves selection
        const u = new URL(window.location.href);
        u.searchParams.set('protocol', id);
        window.history.replaceState({}, '', u.toString());
      }}
    />
  );

  return (
    <PageShell
      pageId="protocol"
      title={`${proto.name} — ${proto.archetype === 'pool' ? 'Pool-Based Lending' : 'Collateralized Debt Position'}`}
      terminal={`protocol-${active}`}
      headerRight={headerSwitcher}
    >
      <KpiStrip items={[
        { id: 'tvl',     label: 'Protocol TVL',      value: fmtUSD(metrics.tvl * 1e6, 1), change: 4.2, note: metrics.tvlNote },
        { id: 'supply',  label: isPool ? 'Total Supplied' : 'Collateral Locked', value: fmtUSD((isPool ? metrics.supply : protoMarkets.reduce((s,v)=>s+v.collateralUsd,0)) * 1e6, 1), change: 5.0 },
        { id: 'borrow',  label: isPool ? 'Total Borrowed' : 'USDB Outstanding',  value: fmtUSD((isPool ? metrics.borrow : protoMarkets.reduce((s,v)=>s+v.debtUsd,0)) * 1e6, 1), change: 3.5 },
        { id: 'users',   label: 'Active Users',      value: fmtNum(metrics.users, 0), change: 2.8 },
      ]} />

      <div className="grid grid-12" style={{ marginTop: 16 }}>
        <ChartPanel
          title={({ metric }) => {
            const labels = { tvl: 'TVL', supply: 'Total Supplied', borrow: 'Total Borrowed', revenue: 'Revenue' };
            return `${proto.name} — ${labels[metric] || 'TVL'} (30D)`;
          }}
          className="col-8"
          protocolMode="none"
          metricItems={[
            { id: 'tvl',    label: 'TVL' },
            { id: 'supply', label: 'Supplied' },
            { id: 'borrow', label: 'Borrowed' },
            { id: 'revenue',label: 'Revenue' },
          ]}
          render={({ metric, size }) => {
            const w = size === 'expanded' ? 1200 : 820;
            const h = size === 'expanded' ? 560 : 300;
            const src = D.tvlMetricSeries[metric] || D.tvlSeries;
            return (
              <AreaChart
                series={[{ name: proto.name, color: proto.color, values: src[tvlIdx].slice(-30).map(x => x.value) }]}
                width={w} height={h} formatter={fmtUSD} valueSuffix="M"
              />
            );
          }}
        />

        <ChartPanel
          title="Markets"
          className="col-4"
          protocolMode="none"
          metricItems={isPool
            ? [{ id: 'supply', label: 'By Supplied' }, { id: 'borrow', label: 'By Borrowed' }, { id: 'util', label: 'By Util' }]
            : [{ id: 'collateralUsd', label: 'By Collateral' }, { id: 'debtUsd', label: 'By USDB Debt' }]
          }
          render={({ metric, size }) => {
            const w = size === 'expanded' ? 1200 : 360;
            const h = size === 'expanded' ? 560 : 300;
            const items = protoMarkets.slice(0, 12).map(m => ({
              id: m.sym, name: m.sym, value: m[metric],
              color: m.risk === 'safe' ? 'var(--green)' : m.risk === 'moderate' ? '#D97706' : 'var(--red)',
            }));
            return <Treemap items={items} width={w} height={h} />;
          }}
        />
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Markets in {proto.name}</span></div>
        <div className="panel-body" style={{ overflowX: 'auto' }}>
          {isPool ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Asset</th>
                  <th style={{ padding: 8 }}>Supply</th>
                  <th style={{ padding: 8 }}>Borrow</th>
                  <th style={{ padding: 8 }}>Supply APY</th>
                  <th style={{ padding: 8 }}>Borrow APY</th>
                  <th style={{ padding: 8 }}>Util</th>
                  <th style={{ padding: 8 }}>LTV</th>
                  <th style={{ padding: 8 }}>Risk</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {protoMarkets.map(m => (
                  <tr key={m.sym} className="row-clickable" onClick={() => goToMarket(m.protocol, m.sym)}
                      style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
                    <td style={{ padding: 8, color: 'var(--fg)' }}>{m.sym}</td>
                    <td style={{ padding: 8 }}>{fmtUSD(m.supply * 1e6, 1)}</td>
                    <td style={{ padding: 8 }}>{fmtUSD(m.borrow * 1e6, 1)}</td>
                    <td style={{ padding: 8, color: 'var(--green)' }}>{m.supplyApy.toFixed(2)}%</td>
                    <td style={{ padding: 8, color: 'var(--red)' }}>{m.borrowApy.toFixed(2)}%</td>
                    <td style={{ padding: 8 }}>{m.util.toFixed(1)}%</td>
                    <td style={{ padding: 8 }}>{m.ltv}%</td>
                    <td style={{ padding: 8 }}><RiskChip risk={m.risk} /></td>
                    <td style={{ padding: 8, color: 'var(--fg-muted)' }}>›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Collateral</th>
                  <th style={{ padding: 8 }}>Locked</th>
                  <th style={{ padding: 8 }}>USDB Debt</th>
                  <th style={{ padding: 8 }}>Interest</th>
                  <th style={{ padding: 8 }}>Min CR</th>
                  <th style={{ padding: 8 }}>Redemption Fee</th>
                  <th style={{ padding: 8 }}>Risk</th>
                  <th style={{ padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {protoMarkets.map(m => (
                  <tr key={m.sym} className="row-clickable" onClick={() => goToMarket(m.protocol, m.sym)}
                      style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
                    <td style={{ padding: 8, color: 'var(--fg)' }}>{m.sym}</td>
                    <td style={{ padding: 8 }}>{fmtUSD(m.collateralUsd * 1e6, 1)}</td>
                    <td style={{ padding: 8 }}>{fmtUSD(m.debtUsd * 1e6, 1)}</td>
                    <td style={{ padding: 8 }}>{m.interestRate.toFixed(2)}%</td>
                    <td style={{ padding: 8 }}>{m.minCR}%</td>
                    <td style={{ padding: 8 }}>{m.redemptionFee.toFixed(2)}%</td>
                    <td style={{ padding: 8 }}><RiskChip risk={m.risk} /></td>
                    <td style={{ padding: 8, color: 'var(--fg-muted)' }}>›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PageShell>
  );
}

// ════════════════════════════════════════════════════════════════
// PAGE 3 — Rates
// ════════════════════════════════════════════════════════════════
function PageRates() {
  // Weighted avg supply/borrow APY across all pool protocols
  const weighted = (rows, ratekey, sizekey) => {
    const total = rows.reduce((s, r) => s + r[sizekey], 0);
    if (!total) return 0;
    return rows.reduce((s, r) => s + r[ratekey] * r[sizekey], 0) / total;
  };
  const avgSupply = weighted(D.pools, 'supplyApy', 'supply');
  const avgBorrow = weighted(D.pools, 'borrowApy', 'borrow');
  const avgUtil   = weighted(D.pools, 'util', 'supply');

  return (
    <PageShell pageId="rates" title="Rates — Supply, Borrow, Utilization" terminal="lending-terminal-sui-rates">
      <KpiStrip items={[
        { id: 'sup',  label: 'Weighted Avg Supply APY', value: `${avgSupply.toFixed(2)}%`, change: 0.18, subLabel: 'across pool protocols' },
        { id: 'bor',  label: 'Weighted Avg Borrow APY', value: `${avgBorrow.toFixed(2)}%`, change: 0.24, subLabel: 'across pool protocols' },
        { id: 'util', label: 'Weighted Avg Utilization',value: `${avgUtil.toFixed(1)}%`,   change: 1.4,  subLabel: 'across pool protocols' },
        { id: 'spread',label:'Avg Spread',              value: `${(avgBorrow - avgSupply).toFixed(2)}%`, change: 0.06, subLabel: 'borrow − supply' },
      ]} />

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Pool-Archetype Rates"
          protocolMode="single"
          metricItems={[
            { id: 'supplyApy',  label: 'Sort: Supply APY' },
            { id: 'borrowApy',  label: 'Sort: Borrow APY' },
            { id: 'util',       label: 'Sort: Utilization' },
            { id: 'supply',     label: 'Sort: TVL' },
          ]}
          defaultMetric="supplyApy"
          render={({ proto, metric, size }) => {
            const rows = D.pools
              .filter(r => matchProto(r, proto))
              .sort((a, b) => b[metric] - a[metric]);
            const maxRows = size === 'expanded' ? rows.length : Math.min(rows.length, 12);
            return (
              <div style={{ overflowX: 'auto', maxHeight: size === 'expanded' ? '70vh' : 480, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Asset</th>
                      <th style={{ padding: 8 }}>Protocol</th>
                      <th style={{ padding: 8 }}>Supply APY</th>
                      <th style={{ padding: 8 }}>Borrow APY</th>
                      <th style={{ padding: 8 }}>Spread</th>
                      <th style={{ padding: 8 }}>Util</th>
                      <th style={{ padding: 8 }}>Kink</th>
                      <th style={{ padding: 8 }}>Reserve</th>
                      <th style={{ padding: 8 }}>30d</th>
                      <th style={{ padding: 8 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, maxRows).map((m, i) => (
                      <tr key={i} className="row-clickable" onClick={() => goToMarket(m.protocol, m.sym)}
                          style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
                        <td style={{ padding: 8, color: 'var(--fg)' }}>{m.sym}</td>
                        <td style={{ padding: 8 }}><ProtocolChip id={m.protocol} /></td>
                        <td style={{ padding: 8, color: 'var(--green)' }}>{m.supplyApy.toFixed(2)}%</td>
                        <td style={{ padding: 8, color: 'var(--red)' }}>{m.borrowApy.toFixed(2)}%</td>
                        <td style={{ padding: 8 }}>{(m.borrowApy - m.supplyApy).toFixed(2)}%</td>
                        <td style={{ padding: 8 }}>{m.util.toFixed(1)}%</td>
                        <td style={{ padding: 8 }}>{m.irmKink}%</td>
                        <td style={{ padding: 8 }}>{m.reserveFactor}%</td>
                        <td style={{ padding: 8 }}><Sparkline values={m.spark} color="var(--blue)" width={80} height={20} /></td>
                        <td style={{ padding: 8, color: 'var(--fg-muted)' }}>›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="CDP-Archetype Rates (Bucket)"
          protocolMode="none"
          metricItems={[
            { id: 'collateralUsd', label: 'Sort: Collateral' },
            { id: 'debtUsd',       label: 'Sort: USDB Debt' },
            { id: 'interestRate',  label: 'Sort: Interest' },
          ]}
          defaultMetric="collateralUsd"
          render={({ metric, size }) => {
            const rows = [...D.vaults].sort((a, b) => b[metric] - a[metric]);
            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Collateral</th>
                      <th style={{ padding: 8 }}>Locked</th>
                      <th style={{ padding: 8 }}>USDB Debt</th>
                      <th style={{ padding: 8 }}>Interest Rate</th>
                      <th style={{ padding: 8 }}>Redemption Fee</th>
                      <th style={{ padding: 8 }}>PSM Fee</th>
                      <th style={{ padding: 8 }}>Min CR</th>
                      <th style={{ padding: 8 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m, i) => (
                      <tr key={i} className="row-clickable" onClick={() => goToMarket('bucket', m.sym)}
                          style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
                        <td style={{ padding: 8, color: 'var(--fg)' }}>{m.sym}</td>
                        <td style={{ padding: 8 }}>{fmtUSD(m.collateralUsd * 1e6, 1)}</td>
                        <td style={{ padding: 8 }}>{fmtUSD(m.debtUsd * 1e6, 1)}</td>
                        <td style={{ padding: 8, color: 'var(--red)' }}>{m.interestRate.toFixed(2)}%</td>
                        <td style={{ padding: 8 }}>{m.redemptionFee.toFixed(2)}%</td>
                        <td style={{ padding: 8 }}>{m.psmFee.toFixed(2)}%</td>
                        <td style={{ padding: 8 }}>{m.minCR}%</td>
                        <td style={{ padding: 8, color: 'var(--fg-muted)' }}>›</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        />
      </div>
    </PageShell>
  );
}

// ════════════════════════════════════════════════════════════════
// PAGE 4 — Revenue
// ════════════════════════════════════════════════════════════════
function PageRevenue() {
  const rows = D.protocols.map(p => {
    const m = D.protocolMetrics.find(x => x.id === p.id);
    const fees30d = m.fees * 30 / 365 * 1e6;
    return { ...p, tvl: m.tvl, fees30d, feesAnnual: m.fees * 1e6 };
  }).sort((a,b) => b.fees30d - a.fees30d);
  const totalFees30d = rows.reduce((s,r) => s + r.fees30d, 0);

  return (
    <PageShell pageId="revenue" title="Revenue — Protocol Fees & Reserves" terminal="lending-terminal-sui-revenue">
      <KpiStrip items={[
        { id: 'r30',  label: 'Total Fees (30D)',  value: fmtUSD(totalFees30d, 2), change: 2.18, spark: D.kpiSparks.revenue.slice(-30) },
        { id: 'rann', label: 'Run-Rate (Annual)', value: fmtUSD(totalFees30d * 365 / 30, 1), change: 1.92 },
        { id: 'topp', label: 'Top Earner',        value: rows[0].name, change: 0, subLabel: fmtUSD(rows[0].fees30d, 2) },
        { id: 'protos',label:'Active Protocols',  value: String(D.protocols.length), change: 0, subLabel: '5 lending + 1 cdp' },
      ]} />

      <div className="grid grid-12" style={{ marginTop: 16 }}>
        <ChartPanel
          title="Revenue by Protocol — 30D"
          className="col-8"
          protocolMode="multi"
          metricItems={[
            { id: 'revenue', label: 'Revenue ($M)' },
            { id: 'tvl',     label: 'TVL ($M)' },
          ]}
          defaultMetric="revenue"
          render={({ proto, metric, size }) => {
            const w = size === 'expanded' ? 1200 : 820;
            const h = size === 'expanded' ? 560 : 300;
            const src = D.tvlMetricSeries[metric] || D.tvlMetricSeries.revenue;
            const series = D.protocols
              .filter(p => proto.includes(p.id))
              .map(p => ({
                name: p.name, color: p.color,
                values: src[D.protocols.indexOf(p)].slice(-30).map(x => x.value),
              }));
            return <AreaChart series={series} stacked width={w} height={h} formatter={fmtUSD} valueSuffix="M" />;
          }}
        />

        <ChartPanel
          title="Fee Mix"
          className="col-4"
          protocolMode="none"
          metricItems={[
            { id: 'fees30d',    label: '30-day Fees' },
            { id: 'feesAnnual', label: 'Annualized' },
          ]}
          defaultMetric="fees30d"
          render={({ metric, size }) => {
            const w = size === 'expanded' ? 1200 : 360;
            const h = size === 'expanded' ? 560 : 300;
            const items = rows.map(r => ({ id: r.id, name: r.name, value: r[metric], color: r.color }));
            return <Treemap items={items} width={w} height={h} />;
          }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Per-Protocol Revenue"
          protocolMode="single"
          metricItems={null}
          render={({ proto, size }) => {
            const filtered = rows.filter(r => proto === 'all' || r.id === proto);
            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Protocol</th>
                      <th style={{ padding: 8 }}>TVL</th>
                      <th style={{ padding: 8 }}>Fees (30D)</th>
                      <th style={{ padding: 8 }}>Annualized</th>
                      <th style={{ padding: 8 }}>Fees / TVL</th>
                      <th style={{ padding: 8 }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                        <td style={{ padding: 8 }}><ProtocolChip id={r.id} /></td>
                        <td style={{ padding: 8 }}>{fmtUSD(r.tvl * 1e6, 1)}</td>
                        <td style={{ padding: 8, color: 'var(--green)' }}>{fmtUSD(r.fees30d, 2)}</td>
                        <td style={{ padding: 8 }}>{fmtUSD(r.feesAnnual, 1)}</td>
                        <td style={{ padding: 8 }}>{(r.feesAnnual / (r.tvl * 1e6) * 100).toFixed(2)}%</td>
                        <td style={{ padding: 8, color: 'var(--fg-muted)' }}>derived (reserve × borrow interest)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        />
      </div>
    </PageShell>
  );
}

// ════════════════════════════════════════════════════════════════
// PAGE 5 — Collateral
// ════════════════════════════════════════════════════════════════
function PageCollateral() {
  // Aggregate by asset across ALL protocols (default) — also support per-protocol view
  const aggByAsset = (protoFilter) => {
    const byAsset = {};
    D.pools.forEach(p => { if (matchProto(p, protoFilter)) byAsset[p.sym] = (byAsset[p.sym] || 0) + p.supply; });
    D.vaults.forEach(v => { if (matchProto(v, protoFilter)) byAsset[v.sym] = (byAsset[v.sym] || 0) + v.collateralUsd; });
    return Object.entries(byAsset).map(([sym, value]) => ({ sym, value })).sort((a,b) => b.value - a.value);
  };

  const allAssetRows = aggByAsset('all');
  const totalCollat = allAssetRows.reduce((s,r) => s + r.value, 0);

  const colorFor = (sym) => {
    const m = { SUI: '#4DA2FF', USDC: '#2775CA', USDT: '#26A17B', WETH: '#627EEA', WBTC: '#F09242', vSUI: '#7C3AED', sSUI: '#FF6B35', afSUI: '#00C896', haSUI: '#E5B345', CETUS: '#9CA3AF' };
    return m[sym] || 'var(--fg-muted)';
  };

  return (
    <PageShell pageId="collateral" title="Collateral — Composition & Concentration" terminal="lending-terminal-sui-collateral">
      <KpiStrip items={[
        { id: 'tot',  label: 'Total Collateral',  value: fmtUSD(totalCollat * 1e6, 1), change: 4.6, subLabel: 'across all protocols' },
        { id: 'top',  label: 'Top Asset',         value: allAssetRows[0].sym, change: 0, subLabel: `${(allAssetRows[0].value / totalCollat * 100).toFixed(1)}%` },
        { id: 'top3', label: 'Top 3 Concentration', value: `${(allAssetRows.slice(0,3).reduce((s,r)=>s+r.value,0) / totalCollat * 100).toFixed(1)}%`, change: 0 },
        { id: 'unique', label: 'Unique Assets',   value: String(allAssetRows.length), change: 0 },
      ]} />

      <div className="grid grid-12" style={{ marginTop: 16 }}>
        <ChartPanel
          title="Collateral by Asset"
          className="col-6"
          protocolMode="single"
          metricItems={null}
          render={({ proto, size }) => {
            const w = size === 'expanded' ? 1200 : 540;
            const h = size === 'expanded' ? 560 : 320;
            const rows = aggByAsset(proto);
            const items = rows.map(r => ({ id: r.sym, name: r.sym, value: r.value, color: colorFor(r.sym) }));
            return <Treemap items={items} width={w} height={h} />;
          }}
        />

        <ChartPanel
          title="Collateral by Protocol"
          className="col-6"
          protocolMode="none"
          metricItems={[
            { id: 'supply', label: 'By Supplied' },
            { id: 'borrow', label: 'By Borrowed' },
            { id: 'tvl',    label: 'By TVL' },
          ]}
          defaultMetric="supply"
          render={({ metric, size }) => {
            const w = size === 'expanded' ? 1200 : 540;
            const h = size === 'expanded' ? 560 : 320;
            const items = D.protocols.map(p => {
              const m = D.protocolMetrics.find(x => x.id === p.id);
              return { id: p.id, name: p.name, value: m[metric], color: p.color };
            });
            return <Treemap items={items} width={w} height={h} />;
          }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Asset → Protocol Allocation"
          protocolMode="single"
          metricItems={null}
          render={({ proto, size }) => {
            const protoCols = proto === 'all' ? D.protocols : D.protocols.filter(p => p.id === proto);
            const rows = aggByAsset(proto);
            return (
              <div style={{ overflowX: 'auto', maxHeight: size === 'expanded' ? '70vh' : 480, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Asset</th>
                      <th style={{ padding: 8 }}>Total Locked</th>
                      <th style={{ padding: 8 }}>% of selection</th>
                      {protoCols.map(p => <th key={p.id} style={{ padding: 8 }}>{p.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const total = rows.reduce((s,x) => s + x.value, 0);
                      return (
                        <tr key={r.sym} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                          <td style={{ padding: 8, color: 'var(--fg)' }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: colorFor(r.sym), marginRight: 6 }} />
                            {r.sym}
                          </td>
                          <td style={{ padding: 8 }}>{fmtUSD(r.value * 1e6, 1)}</td>
                          <td style={{ padding: 8 }}>{(r.value / total * 100).toFixed(1)}%</td>
                          {protoCols.map(p => {
                            const inProto = p.archetype === 'pool'
                              ? D.pools.filter(x => x.protocol === p.id && x.sym === r.sym).reduce((s,x)=>s+x.supply, 0)
                              : D.vaults.filter(x => x.protocol === p.id && x.sym === r.sym).reduce((s,x)=>s+x.collateralUsd, 0);
                            return <td key={p.id} style={{ padding: 8, color: inProto ? 'var(--fg)' : 'var(--fg-dim)' }}>
                              {inProto ? fmtUSD(inProto * 1e6, 1) : '—'}
                            </td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }}
        />
      </div>
    </PageShell>
  );
}

// ════════════════════════════════════════════════════════════════
// PAGE 6 — Liquidation
// ════════════════════════════════════════════════════════════════
function PageLiquidation() {
  const allEvents = D.liquidations;
  const totalRepaid = allEvents.reduce((s,l) => s + l.debtRepaidUsd, 0);
  const totalSeized = allEvents.reduce((s,l) => s + l.collateralSeizedUsd, 0);
  const totalBonus  = allEvents.reduce((s,l) => s + l.bonusUsd, 0);

  const fmt = (s) => new Date(s).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <PageShell pageId="liquidation" title="Liquidations — Events & Severity" terminal="lending-terminal-sui-liquidation">
      <KpiStrip items={[
        { id: 'cnt', label: 'Liquidations (30D)', value: fmtNum(allEvents.length, 0), change: -2.1, subLabel: 'count' },
        { id: 'rep', label: 'Total Debt Repaid',  value: fmtUSD(totalRepaid, 1), change: -3.4 },
        { id: 'sez', label: 'Collateral Seized',  value: fmtUSD(totalSeized, 1), change: -3.2 },
        { id: 'bon', label: 'Liquidator Bonus',   value: fmtUSD(totalBonus, 1), change: -3.1 },
      ]} />

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Liquidation Volume by Protocol — 30D"
          protocolMode="multi"
          metricItems={[
            { id: 'volume', label: 'USD Repaid' },
            { id: 'count',  label: 'Event Count' },
          ]}
          defaultMetric="volume"
          render={({ proto, metric, size }) => {
            const w = size === 'expanded' ? 1200 : 1200;
            const h = size === 'expanded' ? 520 : 260;
            const series = D.protocols
              .filter(p => proto.includes(p.id))
              .map(p => ({
                name: p.name, color: p.color,
                values: D.liquidationSeries.map(d => {
                  if (metric === 'count') {
                    return d.byProtocol[p.id] > 0 ? 1 : 0; // crude per-day count proxy
                  }
                  return d.byProtocol[p.id] || 0;
                }),
              }));
            return <AreaChart series={series} stacked width={w} height={h} formatter={metric === 'count' ? (v => v.toFixed(0)) : fmtUSD} />;
          }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Recent Liquidations"
          protocolMode="single"
          metricItems={[
            { id: 'time',   label: 'Sort: Most recent' },
            { id: 'repaid', label: 'Sort: Largest repaid' },
            { id: 'bonus',  label: 'Sort: Largest bonus' },
            { id: 'hf',     label: 'Sort: Worst HF' },
          ]}
          defaultMetric="time"
          render={({ proto, metric, size }) => {
            let events = allEvents.filter(l => matchProto(l, proto));
            if (metric === 'repaid') events = [...events].sort((a,b) => b.debtRepaidUsd - a.debtRepaidUsd);
            else if (metric === 'bonus') events = [...events].sort((a,b) => b.bonusUsd - a.bonusUsd);
            else if (metric === 'hf') events = [...events].sort((a,b) => a.healthFactor - b.healthFactor);
            const limit = size === 'expanded' ? events.length : 60;
            return (
              <div style={{ overflowX: 'auto', maxHeight: size === 'expanded' ? '70vh' : 480, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Time</th>
                      <th style={{ padding: 8 }}>Protocol</th>
                      <th style={{ padding: 8 }}>Debt</th>
                      <th style={{ padding: 8 }}>Collateral</th>
                      <th style={{ padding: 8 }}>Repaid</th>
                      <th style={{ padding: 8 }}>Seized</th>
                      <th style={{ padding: 8 }}>Bonus</th>
                      <th style={{ padding: 8 }}>HF</th>
                      <th style={{ padding: 8 }}>Borrower</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.slice(0, limit).map((l, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                        <td style={{ padding: 6, color: 'var(--fg-muted)' }}>{fmt(l.t)}</td>
                        <td style={{ padding: 6 }}><ProtocolChip id={l.protocol} /></td>
                        <td style={{ padding: 6 }}>{l.debtAsset}</td>
                        <td style={{ padding: 6 }}>{l.collateralAsset}</td>
                        <td style={{ padding: 6, color: 'var(--red)' }}>{fmtUSD(l.debtRepaidUsd, 0)}</td>
                        <td style={{ padding: 6 }}>{fmtUSD(l.collateralSeizedUsd, 0)}</td>
                        <td style={{ padding: 6, color: 'var(--green)' }}>+{fmtUSD(l.bonusUsd, 0)}</td>
                        <td style={{ padding: 6, color: l.healthFactor < 0.9 ? 'var(--red)' : 'var(--fg)' }}>{l.healthFactor.toFixed(3)}</td>
                        <td style={{ padding: 6, color: 'var(--fg-muted)' }}>{l.borrower}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        />
      </div>
    </PageShell>
  );
}

// ════════════════════════════════════════════════════════════════
// SUB-PAGE — MarketDetail (one specific market on one protocol)
// URL: MarketDetail.html?protocol=navi&market=SUI
// ════════════════════════════════════════════════════════════════
function PageMarketDetail() {
  const params = new URLSearchParams(window.location.search);
  const protoId = params.get('protocol') || 'navi';
  const marketSym = params.get('market') || 'SUI';
  const proto = PROTO[protoId];
  const isPool = proto?.archetype === 'pool';

  // Lookup
  const market = isPool
    ? D.pools.find(p => p.protocol === protoId && p.sym === marketSym)
    : D.vaults.find(v => v.protocol === protoId && v.sym === marketSym);

  if (!market) {
    return (
      <PageShell pageId="market" title="Market not found" terminal="market-detail">
        <div className="panel" style={{ marginTop: 16, padding: 24, fontFamily: 'var(--font-mono)' }}>
          No market for protocol <code>{protoId}</code> + asset <code>{marketSym}</code>.
          {' '}<a href="Protocol.html" onClick={() => showNavSplash?.()}>Back to Protocol</a>
        </div>
      </PageShell>
    );
  }

  const price = priceOf(marketSym);
  const back = (
    <a href={`Protocol.html?protocol=${protoId}`}
       onClick={() => typeof showNavSplash === 'function' && showNavSplash()}
       style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', textDecoration: 'none' }}>
      ‹ Back to {proto.name}
    </a>
  );

  // ── POOL archetype ─────────────────────────────────────────
  if (isPool) {
    const supplyUsd = market.supply * 1e6;
    const borrowUsd = market.borrow * 1e6;
    const liqUsd = supplyUsd - borrowUsd;
    const supplyTok = supplyUsd / price;
    const borrowTok = borrowUsd / price;
    const liqTok = liqUsd / price;
    const supplyCapPct = market.supplyCap ? (supplyTok / market.supplyCap * 100) : 0;
    const borrowCapPct = market.borrowCap ? (borrowTok / market.borrowCap * 100) : 0;

    // Interest rate curve
    const curve = (() => {
      const k = market.irmKink / 100;
      const base = market.irmBaseRate;
      const mul  = market.irmMultiplier;
      const jmp  = market.irmJumpMult;
      const rf   = market.reserveFactor / 100;
      const points = [];
      for (let u = 0; u <= 100; u += 2) {
        const ux = u / 100;
        const borrowR = ux <= k
          ? base + (ux / k) * mul
          : base + mul + ((ux - k) / (1 - k)) * jmp;
        const supplyR = borrowR * ux * (1 - rf);
        points.push({ u, supplyR, borrowR });
      }
      return points;
    })();

    return (
      <PageShell
        pageId="market"
        title={`${marketSym} on ${proto.name}`}
        terminal={`market-${protoId}-${marketSym.toLowerCase()}`}
        headerRight={back}
      >
        <KpiStrip items={[
          { id: 'sup',  label: 'Total Supplied',  value: fmtUSD(supplyUsd, 2), change: 4.2, subLabel: `${fmtNum(supplyTok, 1)} ${marketSym}` },
          { id: 'bor',  label: 'Total Borrowed',  value: fmtUSD(borrowUsd, 2), change: 3.1, subLabel: `${fmtNum(borrowTok, 1)} ${marketSym}` },
          { id: 'liq',  label: 'Available Liquidity', value: fmtUSD(liqUsd, 2), change: 0, subLabel: `${fmtNum(liqTok, 1)} ${marketSym}` },
          { id: 'util', label: 'Utilization',     value: `${market.util.toFixed(1)}%`, change: 0.4, subLabel: 'borrow / supply' },
        ]} />

        {/* Three side-by-side parameter cards */}
        <div className="grid grid-12" style={{ marginTop: 16 }}>
          <div className="panel col-4">
            <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Interest Rates</span></div>
            <div className="panel-body">
              <ParamRow k="Supply APY" v={`${market.supplyApy.toFixed(2)}%`} c="var(--green)" />
              <ParamRow k="Borrow APY" v={`${market.borrowApy.toFixed(2)}%`} c="var(--red)" />
              <ParamRow k="Spread"     v={`${(market.borrowApy - market.supplyApy).toFixed(2)}%`} />
              <ParamRow k="Base Rate"     v={`${market.irmBaseRate.toFixed(2)}%`} />
              <ParamRow k="Multiplier"    v={`${market.irmMultiplier.toFixed(2)}%`} />
              <ParamRow k="Jump Mult."    v={`${market.irmJumpMult.toFixed(2)}%`} />
              <ParamRow k="Kink"          v={`${market.irmKink}%`} />
            </div>
          </div>

          <div className="panel col-4">
            <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Risk Parameters</span></div>
            <div className="panel-body">
              <ParamRow k="LTV (Coll. Factor)" v={`${market.ltv}%`} />
              <ParamRow k="Liquidation Thresh." v={`${market.liqThreshold}%`} />
              <ParamRow k="Reserve Factor"  v={`${market.reserveFactor}%`} />
              <ParamRow k="Supply Cap" v={`${fmtNum(market.supplyCap, 0)} ${marketSym}`} />
              <ParamRow k="Borrow Cap" v={`${fmtNum(market.borrowCap, 0)} ${marketSym}`} />
              <ParamRow k="Supply Cap Used"  v={`${supplyCapPct.toFixed(1)}%`} c={supplyCapPct > 80 ? 'var(--red)' : 'var(--fg)'} />
              <ParamRow k="Borrow Cap Used"  v={`${borrowCapPct.toFixed(1)}%`} c={borrowCapPct > 80 ? 'var(--red)' : 'var(--fg)'} />
            </div>
          </div>

          <div className="panel col-4">
            <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Market Info</span></div>
            <div className="panel-body">
              <ParamRow k="Asset" v={marketSym} />
              <ParamRow k="Protocol" v={proto.name} />
              <ParamRow k="Risk Tier" v={<RiskChip risk={market.risk} />} />
              <ParamRow k="Oracle" v={market.oracleSource} />
              <ParamRow k="Suppliers" v={fmtNum(market.suppliers, 0)} />
              <ParamRow k="Borrowers" v={fmtNum(market.borrowers, 0)} />
              <ParamRow k="Spot Price" v={fmtUSD(price, price < 10 ? 4 : 2)} />
            </div>
          </div>
        </div>

        {/* History charts */}
        <div className="grid grid-12" style={{ marginTop: 16 }}>
          <ChartPanel
            title={`${marketSym} — Supply & Borrow History`}
            className="col-6"
            protocolMode="none"
            metricItems={[
              { id: 'usd',   label: 'USD' },
              { id: 'token', label: 'Token' },
            ]}
            defaultMetric="usd"
            render={({ metric, size }) => {
              const w = size === 'expanded' ? 1200 : 540;
              const h = size === 'expanded' ? 520 : 280;
              const scale = metric === 'token' ? 1e6 / price : 1e6;
              const series = [
                { name: 'Supply', color: '#FF6B35', values: market.history.slice(-30).map(d => d.supply * scale) },
                { name: 'Borrow', color: '#3B5FE0', values: market.history.slice(-30).map(d => d.borrow * scale) },
              ];
              return <AreaChart series={series} width={w} height={h} formatter={metric === 'token' ? (v => fmtNum(v, 0)) : fmtUSD} />;
            }}
          />

          <ChartPanel
            title={`${marketSym} — APY History`}
            className="col-6"
            protocolMode="none"
            metricItems={null}
            render={({ size }) => {
              const w = size === 'expanded' ? 1200 : 540;
              const h = size === 'expanded' ? 520 : 280;
              const series = [
                { name: 'Supply APY', color: 'var(--green)', values: market.apyHistory.slice(-30).map(d => d.supply) },
                { name: 'Borrow APY', color: 'var(--red)',   values: market.apyHistory.slice(-30).map(d => d.borrow) },
              ];
              return <AreaChart series={series} width={w} height={h} formatter={v => `${v.toFixed(2)}%`} />;
            }}
          />
        </div>

        {/* Interest rate curve */}
        <div style={{ marginTop: 16 }}>
          <ChartPanel
            title={`${marketSym} — Interest Rate Curve (model)`}
            protocolMode="none"
            metricItems={null}
            render={({ size }) => {
              const w = size === 'expanded' ? 1200 : 1200;
              const h = size === 'expanded' ? 520 : 280;
              return (
                <AreaChart
                  series={[
                    { name: 'Supply Rate', color: 'var(--green)', values: curve.map(p => p.supplyR) },
                    { name: 'Borrow Rate', color: 'var(--red)',   values: curve.map(p => p.borrowR) },
                  ]}
                  width={w} height={h}
                  formatter={v => `${v.toFixed(2)}%`}
                />
              );
            }}
          />
          <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center' }}>
            X-axis: utilization 0% → 100%. Kink at {market.irmKink}%. Current util: {market.util.toFixed(1)}%.
          </div>
        </div>
      </PageShell>
    );
  }

  // ── CDP archetype (Bucket vault) ───────────────────────────
  return (
    <PageShell
      pageId="market"
      title={`${marketSym} Vault on ${proto.name}`}
      terminal={`vault-${protoId}-${marketSym.toLowerCase()}`}
      headerRight={back}
    >
      <KpiStrip items={[
        { id: 'col', label: 'Collateral Locked', value: fmtUSD(market.collateralUsd * 1e6, 2), change: 4.0, subLabel: `${fmtNum(market.collateralUsd * 1e6 / price, 1)} ${marketSym}` },
        { id: 'dbt', label: 'USDB Outstanding',  value: fmtUSD(market.debtUsd * 1e6, 2), change: 3.4 },
        { id: 'cr',  label: 'Aggregate CR',      value: `${(market.collateralUsd / market.debtUsd * 100).toFixed(0)}%`, change: 0, subLabel: `min ${market.minCR}%` },
        { id: 'rate',label: 'Interest Rate',     value: `${market.interestRate.toFixed(2)}%`, change: 0 },
      ]} />

      <div className="grid grid-12" style={{ marginTop: 16 }}>
        <div className="panel col-6">
          <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Vault Parameters</span></div>
          <div className="panel-body">
            <ParamRow k="Collateral Asset" v={marketSym} />
            <ParamRow k="Stablecoin Issued" v="USDB" />
            <ParamRow k="Interest Rate"     v={`${market.interestRate.toFixed(2)}%`} c="var(--red)" />
            <ParamRow k="Redemption Fee"    v={`${market.redemptionFee.toFixed(2)}%`} />
            <ParamRow k="PSM Fee"           v={`${market.psmFee.toFixed(2)}%`} />
            <ParamRow k="Min Collateral Ratio" v={`${market.minCR}%`} />
            <ParamRow k="Risk Tier"         v={<RiskChip risk={market.risk} />} />
          </div>
        </div>

        <div className="panel col-6">
          <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Health Metrics</span></div>
          <div className="panel-body">
            <ParamRow k="Aggregate CR" v={`${(market.collateralUsd / market.debtUsd * 100).toFixed(1)}%`} />
            <ParamRow k="Headroom over Min CR" v={`${(market.collateralUsd / market.debtUsd * 100 - market.minCR).toFixed(1)}pp`} />
            <ParamRow k="USDB / Collateral" v={`${(market.debtUsd / market.collateralUsd * 100).toFixed(1)}%`} />
            <ParamRow k="Spot Price" v={fmtUSD(price, price < 10 ? 4 : 2)} />
            <ParamRow k="Oracle" v="Pyth" />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title={`${marketSym} Vault — TVL trend`}
          protocolMode="none"
          metricItems={null}
          render={({ size }) => {
            const w = size === 'expanded' ? 1200 : 1200;
            const h = size === 'expanded' ? 520 : 260;
            return (
              <AreaChart
                series={[{ name: 'Collateral (indexed)', color: proto.color, values: market.spark }]}
                width={w} height={h}
              />
            );
          }}
        />
      </div>
    </PageShell>
  );
}

function ParamRow({ k, v, c }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-soft)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      <span style={{ color: 'var(--fg-muted)' }}>{k}</span>
      <span style={{ color: c || 'var(--fg)' }}>{v}</span>
    </div>
  );
}

Object.assign(window, { PageOverview, PageProtocol, PageRates, PageRevenue, PageCollateral, PageLiquidation, PageMarketDetail });
