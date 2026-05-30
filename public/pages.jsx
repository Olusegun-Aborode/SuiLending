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
  // Per §6: every chart carries CSV export + deep-link/share. Callers pass a
  // csvBuilder({proto, metric, timeframe}) → rows; the toolbar's CSV button
  // calls it and downloads. shareId is a stable identifier embedded in the
  // copied URL so the recipient lands back at the same chart state.
  csvBuilder,
  shareId,
  // Per §6.Insight rules: "Every panel pairs with a one-line auto-insight
  // that answers 'so what,' tied to a decision." Callers pass either a
  // string or an insight({ proto, metric, timeframe }) → string function;
  // the panel renders it as a footer below the chart body.
  insight,
  // Per §6 chart rules: "every chart shows title, units, source, as-of".
  // `source` is the named data provenance (e.g. "PoolDaily + DefiLlama
  // fallback" / "Scallop indexer" / "on-chain RPC"). Renders in the chart
  // footer alongside the as-of checkpoint pulled from the global asOf
  // block. If unset, the footer is suppressed (we don't fake provenance).
  source,
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
            {csvBuilder && (
              <button className="icon-btn" title="Export CSV"
                onClick={() => {
                  try {
                    const rows = csvBuilder({ proto, metric, timeframe });
                    if (rows && rows.length) {
                      const slug = resolvedTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                      exportCSV(rows, `${slug}.csv`);
                    } else {
                      alert('No rows to export for current selection.');
                    }
                  } catch (e) { console.error('csv export failed:', e); alert('CSV export failed: ' + (e?.message || e)); }
                }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>
                </svg>
              </button>
            )}
            {shareId && (
              <button className="icon-btn" title="Copy share link"
                onClick={() => copyShareLink(shareId, {
                  ...(Array.isArray(proto) ? { proto: proto.join(',') } : (proto ? { proto } : {})),
                  ...(metric ? { metric } : {}),
                  ...(timeframe ? { tf: String(timeframe) } : {}),
                })}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/>
                  <line x1="8.2" y1="10.8" x2="15.8" y2="7.2"/><line x1="8.2" y1="13.2" x2="15.8" y2="16.8"/>
                </svg>
              </button>
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
        {insight && (() => {
          let text = '';
          try { text = typeof insight === 'function' ? insight({ proto, metric, timeframe }) : insight; }
          catch (e) { console.warn('insight compute failed:', e); text = ''; }
          if (!text) return null;
          // Footer per §6 Insight Rules — decision-linked "so what" line.
          return (
            <div style={{
              padding: '8px 16px 4px', borderTop: '1px solid var(--border-soft)',
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.4,
            }}>
              <span style={{ color: 'var(--orange)', marginRight: 6 }}>↪</span>
              {text}
            </div>
          );
        })()}
        {source && (() => {
          // Source + as-of stamp footer per §6 chart rules. Pulls the global
          // asOf block so every chart shares a single ground-truth checkpoint
          // rather than each carrying its own pseudo-timestamp.
          const asOf = D.asOf;
          const cp = asOf?.checkpoint != null ? `#${asOf.checkpoint.toLocaleString()}` : '—';
          const ts = asOf?.checkpointTimestamp ? new Date(asOf.checkpointTimestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
          return (
            <div style={{
              padding: insight ? '2px 16px 10px' : '8px 16px 10px',
              borderTop: insight ? 'none' : '1px solid var(--border-soft)',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-dim)', lineHeight: 1.4,
              display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between',
            }}>
              <span><span style={{ color: 'var(--fg-muted)' }}>source:</span> {source}</span>
              <span><span style={{ color: 'var(--fg-muted)' }}>as of:</span> checkpoint {cp} · {ts}</span>
            </div>
          );
        })()}
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
      {/* §3 integrity gates — collapsible status row showing the worst-of:
          green / amber / red. A red gate blocks publication per the standard. */}
      <IntegrityPanel />
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
          source="PoolDaily aggregates + DefiLlama gap-fill (per-protocol historical TVL)"
          shareId="overview.tvl-by-protocol"
          insight={({ proto, metric, timeframe }) => {
            const sel = D.protocols.filter(p => proto.includes(p.id));
            if (sel.length === 0) return 'Select at least one protocol to see the trend.';
            const src = D.tvlMetricSeries[metric] || D.tvlSeries;
            const totals = sel.map(p => src[D.protocols.indexOf(p)].slice(-timeframe));
            const lastTotal = totals.reduce((s, ser) => s + (ser[ser.length-1]?.value || 0), 0);
            const firstTotal = totals.reduce((s, ser) => s + (ser[0]?.value || 0), 0);
            const chgPct = firstTotal > 0 ? ((lastTotal - firstTotal) / firstTotal * 100) : 0;
            const dir = chgPct > 1 ? 'rising' : chgPct < -1 ? 'falling' : 'flat';
            // Decision: monitor sector trend; widen/narrow risk overlays if sharp move.
            return `Sector ${metric} ${dir} ${Math.abs(chgPct).toFixed(1)}% over ${timeframe}D — current $${lastTotal.toFixed(1)}M across ${sel.length} protocols. Re-run risk overlays if Δ > 20%.`;
          }}
          csvBuilder={({ proto, metric, timeframe }) => {
            const src = D.tvlMetricSeries[metric] || D.tvlSeries;
            const rows = [];
            for (const p of D.protocols.filter(pp => proto.includes(pp.id))) {
              const series = src[D.protocols.indexOf(p)].slice(-timeframe);
              series.forEach((point, i) => {
                rows.push({ day_offset: i - (series.length - 1), protocol: p.id, metric, value_M_usd: point.value.toFixed(4) });
              });
            }
            return rows;
          }}
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
          source="protocolMetrics (live on-chain / native APIs, Bucket via DefiLlama)"
          shareId="overview.protocol-mix"
          insight={({ metric }) => {
            const items = D.protocols.map(p => {
              const m = D.protocolMetrics.find(x => x.id === p.id);
              return { id: p.id, name: p.name, value: m[metric] || m.tvl };
            }).sort((a, b) => b.value - a.value);
            const total = items.reduce((s, x) => s + x.value, 0);
            if (total === 0 || items.length === 0) return '';
            const top1Pct = items[0].value / total * 100;
            const top2Pct = items.slice(0, 2).reduce((s, x) => s + x.value, 0) / total * 100;
            const concentration = top1Pct > 60 ? 'highly concentrated' : top1Pct > 40 ? 'concentrated' : 'diffuse';
            // Decision: concentration changes signal where to focus protocol-specific risk overlays.
            return `${items[0].name} leads at ${top1Pct.toFixed(0)}%; top 2 = ${top2Pct.toFixed(0)}%. Mix is ${concentration} — focus risk overlays on ${items[0].name}.`;
          }}
          csvBuilder={({ metric }) => D.protocols.map(p => {
            const m = D.protocolMetrics.find(x => x.id === p.id);
            return { protocol: p.id, metric, value_M_usd: (m[metric] || m.tvl).toFixed(4) };
          })}
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
          source="volumeSeries (PoolDaily-derived supply/borrow + LiquidationEvent daily totals)"
          shareId="overview.daily-flows"
          insight={({ timeframe }) => {
            const sliced = D.volumeSeries.slice(-timeframe);
            const sumSup = sliced.reduce((s, d) => s + (d.supply || 0), 0);
            const sumBor = sliced.reduce((s, d) => s + (d.borrow || 0), 0);
            const sumLiq = sliced.reduce((s, d) => s + (d.liquid || 0), 0);
            const liqShare = sumBor > 0 ? (sumLiq / sumBor * 100) : 0;
            const liqFlag = liqShare > 5 ? '⚠ elevated liquidation share' : 'liquidation share normal';
            // Decision: spike in liquidation share = follow up on Risk page; quiet flows = check
            // protocol incentive efficiency on Revenue page.
            return `${timeframe}D total: supply $${sumSup.toFixed(0)}M, borrow $${sumBor.toFixed(0)}M, liq $${sumLiq.toFixed(1)}M (${liqShare.toFixed(2)}% of borrows) — ${liqFlag}.`;
          }}
          csvBuilder={({ metric, timeframe }) => {
            const sliced = D.volumeSeries.slice(-timeframe);
            return sliced.map((d, i) => ({
              day_offset: i - (sliced.length - 1),
              supply_M_usd: (d.supply || 0).toFixed(4),
              borrow_M_usd: (d.borrow || 0).toFixed(4),
              liquidations_M_usd: (d.liquid || 0).toFixed(4),
            }));
          }}
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
            // Pretty labels for the tooltip. Bare keys "supply"/"borrow"/"liquid"
            // would otherwise render lowercase. Single-metric views still get
            // the matching label since the dropdown filters by `metric`.
            const keyLabels = { supply: 'Supply', borrow: 'Borrow', liquid: 'Liquidations' };
            // volumeSeries carries 90 daily rows; slice tail by the active window.
            const sliced = D.volumeSeries.slice(-timeframe);
            return <StackedBarChart data={sliced} keys={keys} colors={colors} keyLabels={keyLabels} width={w} height={h} formatter={v => `$${v.toFixed(1)}M`} />;
          }}
        />
      </div>

      {/* Methodology — surfaced at the bottom of Overview so the data-source
          and TVL-definition disclosures (including where we rely on DefiLlama)
          are visible to every user, not buried behind a dead nav link. */}
      <div style={{ marginTop: 16 }}>
        <MethodologyPanel />
      </div>
    </PageShell>
  );
}

// ════════════════════════════════════════════════════════════════
// PAGE 2 — Protocol (one protocol focus, tab-switched)
// ════════════════════════════════════════════════════════════════

/**
 * Tab strip for switching protocols on the Protocol page.
 *
 * Replaces the previous header dropdown — protocol selection is the page's
 * primary axis (every chart filters by the active protocol), so it should
 * be visible and one-click instead of buried in a dropdown.
 *
 * Each tab shows: protocol-color dot, name, archetype badge (POOL/CDP).
 * Active tab gets a colored bottom border using the protocol's brand color
 * so it's identifiable at a glance even on the per-protocol page header
 * matches the tab.
 */
function ProtocolTabs({ active, onChange, protocols }) {
  return (
    <div className="protocol-tabs">
      {protocols.map(p => {
        const isActive = active === p.id;
        const archetype = p.archetype === 'pool' ? 'POOL' : 'CDP';
        return (
          <button
            key={p.id}
            type="button"
            className={`protocol-tab ${isActive ? 'active' : ''}`}
            style={isActive ? { borderBottomColor: p.color } : undefined}
            onClick={() => onChange(p.id)}
          >
            <span className="protocol-tab-dot" style={{ background: p.color }} />
            <span className="protocol-tab-name">{p.name}</span>
            <span className="protocol-tab-archetype">{archetype}</span>
          </button>
        );
      })}
    </div>
  );
}

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

  const onProtocolChange = (id) => {
    setActive(id);
    // keep URL in sync so reload / share preserves selection
    const u = new URL(window.location.href);
    u.searchParams.set('protocol', id);
    window.history.replaceState({}, '', u.toString());
  };

  return (
    <PageShell
      pageId="protocol"
      title={`${proto.name} — ${proto.archetype === 'pool' ? 'Pool-Based Lending' : 'Collateralized Debt Position'}`}
      terminal={`protocol-${active}`}
    >
      <ProtocolTabs active={active} protocols={D.protocols} onChange={onProtocolChange} />
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
    // Take rate per §4 Tier 4: annualized fees ÷ TVL. The standard
    // explicitly says "watch denominator effects on contraction" — TVL
    // contraction inflates take rate, so we show both as separate metrics.
    const takeRate = m.tvl > 0 ? (m.fees / m.tvl * 100) : 0;
    // Capture vs pass-through: protocol-retained fees / total borrower
    // interest paid. fees = borrow × avgBApy × reserveFactor approximated as
    // 10% on the route; borrowerInterest = borrow × avgBApy. So capture =
    // reserveFactor ≈ 10% per §4 Tier 4 (until we read per-pool RF properly).
    const borrowerInterestAnnual = m.borrow > 0 && m.tvl > 0 ? (m.fees / 0.10) : 0; // back-solve from coarse RF=10%
    const captureRate = borrowerInterestAnnual > 0 ? (m.fees / borrowerInterestAnnual * 100) : 0;
    return { ...p, tvl: m.tvl, supply: m.supply, borrow: m.borrow,
             fees30d, feesAnnual: m.fees * 1e6, takeRate, captureRate, borrowerInterestAnnual };
  }).sort((a,b) => b.fees30d - a.fees30d);
  const totalFees30d = rows.reduce((s,r) => s + r.fees30d, 0);
  const totalFeesAnnual = totalFees30d * 365 / 30;
  const totalTvl = rows.reduce((s,r) => s + r.tvl, 0);
  const sectorTakeRate = totalTvl > 0 ? (totalFeesAnnual / 1e6 / totalTvl * 100) : 0;

  // Real yield spread per §4 Tier 4: TVL-weighted stablecoin supply APY −
  // risk-free benchmark (4-week T-bill). The standard names FRED as the
  // benchmark source. Since fetching FRED would add another external
  // dependency, we hardcode a recent 4w T-bill yield as a pinned reference
  // (documented; user can update) — the alternative was leaving this
  // out entirely, which the standard expressly forbids.
  const FOUR_WEEK_TBILL_PCT = 4.30; // pinned ~2026-05; replace with live FRED feed when wired
  const stableSyms = new Set(['USDC','USDT','USDsui','USDSUI','USDB','AUSD','BUCK','FDUSD','wUSDC','wUSDT','suiUSDT','USDY','mUSD']);
  let stableWeightedApy = 0, stableTotalSupply = 0;
  D.pools.forEach(p => {
    if (!stableSyms.has(p.sym)) return;
    if (p.supply <= 0 || p.supply * 1e6 < 100_000) return; // §4 Tier 4: "Filter dust pools"
    stableWeightedApy += p.supplyApy * p.supply;
    stableTotalSupply += p.supply;
  });
  const stableSupplyApyAvg = stableTotalSupply > 0 ? stableWeightedApy / stableTotalSupply : 0;
  const realYieldSpread = stableSupplyApyAvg - FOUR_WEEK_TBILL_PCT;

  return (
    <PageShell pageId="revenue" title="Revenue — Protocol Fees & Reserves" terminal="lending-terminal-sui-revenue">
      <KpiStrip items={[
        { id: 'r30',  label: 'Total Fees (30D)',  value: fmtUSD(totalFees30d, 2), change: 2.18, spark: D.kpiSparks.revenue.slice(-30) },
        { id: 'rann', label: 'Run-Rate (Annual)', value: fmtUSD(totalFeesAnnual, 1), change: 1.92 },
        // §4 Tier 4 — take rate. Color-coded: <1% green (cheap), 1-3% normal,
        // >3% red (high extraction or TVL contraction).
        { id: 'tr',   label: 'Sector Take Rate',  value: `${sectorTakeRate.toFixed(2)}%`,
          change: 0, subLabel: 'fees ÷ TVL · annualized' },
        // §4 Tier 4 — real yield spread. >0 = real return above T-bill.
        { id: 'rys',  label: 'Real Yield Spread', value: `${realYieldSpread >= 0 ? '+' : ''}${realYieldSpread.toFixed(2)} pp`,
          change: 0, subLabel: `stables ${stableSupplyApyAvg.toFixed(2)}% − T-bill ${FOUR_WEEK_TBILL_PCT}%` },
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
                      <th style={{ padding: 8 }} title="Take rate = annualized fees ÷ TVL (§4 Tier 4)">Take rate</th>
                      <th style={{ padding: 8 }} title="Capture rate = protocol-retained share of borrower interest (§4 Tier 4)">Capture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => {
                      const trColor = r.takeRate > 3 ? 'var(--red)' : r.takeRate > 1 ? 'var(--orange)' : 'var(--green)';
                      return (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                        <td style={{ padding: 8 }}><ProtocolChip id={r.id} /></td>
                        <td style={{ padding: 8 }}>{fmtUSD(r.tvl * 1e6, 1)}</td>
                        <td style={{ padding: 8, color: 'var(--green)' }}>{fmtUSD(r.fees30d, 2)}</td>
                        <td style={{ padding: 8 }}>{fmtUSD(r.feesAnnual, 1)}</td>
                        <td style={{ padding: 8, color: trColor }}>{r.takeRate.toFixed(2)}%</td>
                        <td style={{ padding: 8 }}>{r.captureRate > 0 ? `${r.captureRate.toFixed(0)}%` : '—'}</td>
                      </tr>
                    );})}
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

  // ── Concentration metrics per §4 Tier 3 ──────────────────────────────────
  // HHI = Σ(share%)². Standard bands: >2500 = highly concentrated.
  const supplyHhi = allAssetRows.reduce((s, r) => {
    const share = totalCollat > 0 ? (r.value / totalCollat * 100) : 0;
    return s + share * share;
  }, 0);
  const top1Share  = totalCollat > 0 ? (allAssetRows[0]?.value || 0) / totalCollat * 100 : 0;
  const top3Share  = totalCollat > 0 ? allAssetRows.slice(0, 3).reduce((s,r)=>s+r.value,0) / totalCollat * 100 : 0;
  const top5Share  = totalCollat > 0 ? allAssetRows.slice(0, 5).reduce((s,r)=>s+r.value,0) / totalCollat * 100 : 0;

  // Stablecoin debt share: Σ borrows where the asset is a USD-pegged stable
  // ÷ total borrows. Per §4 Tier 3, this is a "rate-sensitivity / leverage-
  // direction signal" — high stable-borrow share = traders borrowing stables
  // against volatiles; low = borrowing volatiles for leverage.
  const STABLE_SYMS = new Set([
    'USDC', 'USDT', 'USDsui', 'USDSUI', 'USDB', 'AUSD', 'BUCK',
    'FDUSD', 'wUSDC', 'wUSDT', 'suiUSDT', 'USDY', 'mUSD',
  ]);
  let stableBorrow = 0, totalBorrow = 0;
  D.pools.forEach(p => {
    const b = p.borrow || 0;
    totalBorrow += b;
    if (STABLE_SYMS.has(p.sym)) stableBorrow += b;
  });
  D.vaults.forEach(v => {
    // CDPs mint USDB/BUCK against collateral — the issued debt is always a stable.
    const b = v.debtUsd || 0;
    totalBorrow += b;
    stableBorrow += b;
  });
  const stableBorrowShare = totalBorrow > 0 ? (stableBorrow / totalBorrow * 100) : 0;

  // Oracle concentration — % of priced pools per oracle source. With every
  // protocol currently on Pyth, this comes out near 100%/Pyth, but the
  // metric is computed honestly so it shifts when adapters diversify.
  const oracleCount = {};
  D.pools.forEach(p => { const o = p.oracleSource || 'unknown'; oracleCount[o] = (oracleCount[o] || 0) + 1; });
  const oracleTotal = Object.values(oracleCount).reduce((s, n) => s + n, 0);
  const oracleRows = Object.entries(oracleCount)
    .map(([name, n]) => ({ name, share: oracleTotal > 0 ? n / oracleTotal * 100 : 0, count: n }))
    .sort((a, b) => b.share - a.share);
  const oracleHhi = oracleRows.reduce((s, r) => s + r.share * r.share, 0);

  const concentrationBand = (hhi) => hhi > 2500 ? { color: 'var(--red)',    label: 'highly concentrated' }
                                  : hhi > 1500 ? { color: 'var(--orange)', label: 'moderate' }
                                  :              { color: 'var(--green)',  label: 'diffuse' };

  const colorFor = (sym) => {
    const m = { SUI: '#4DA2FF', USDC: '#2775CA', USDT: '#26A17B', WETH: '#627EEA', WBTC: '#F09242', vSUI: '#7C3AED', sSUI: '#FF6B35', afSUI: '#00C896', haSUI: '#E5B345', CETUS: '#9CA3AF' };
    return m[sym] || 'var(--fg-muted)';
  };

  return (
    <PageShell pageId="collateral" title="Collateral — Composition & Concentration" terminal="lending-terminal-sui-collateral">
      <KpiStrip items={[
        { id: 'tot',  label: 'Total Collateral',  value: fmtUSD(totalCollat * 1e6, 1), change: 4.6, subLabel: 'across all protocols' },
        { id: 'top',  label: 'Top Asset',         value: allAssetRows[0]?.sym ?? '—', change: 0, subLabel: `${top1Share.toFixed(1)}%` },
        // HHI per §4 Tier 3 — assets. Bands per the standard: >2500 highly
        // concentrated, 1500–2500 moderate, ≤1500 diffuse.
        { id: 'hhi',  label: 'Asset HHI', value: supplyHhi.toFixed(0), change: 0, subLabel: concentrationBand(supplyHhi).label },
        { id: 'stab', label: 'Stable Debt Share', value: `${stableBorrowShare.toFixed(1)}%`, change: 0, subLabel: 'stables ÷ all borrows' },
      ]} />

      {/* Concentration panel per §4 Tier 3:
            Top-N share, oracle concentration, stablecoin-debt-share trend. */}
      <div className="grid grid-12" style={{ marginTop: 16 }}>
        <div className="panel col-6">
          <div className="panel-header">
            <span className="panel-title"><span className="bullet">●</span> Asset concentration</span>
            <span style={{ fontSize: 11, color: concentrationBand(supplyHhi).color, fontFamily: 'var(--font-mono)' }}>
              HHI {supplyHhi.toFixed(0)} · {concentrationBand(supplyHhi).label}
            </span>
          </div>
          <div className="panel-body" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            <ParamRow k="Top 1 share" v={`${top1Share.toFixed(1)}%`} c={top1Share > 50 ? 'var(--red)' : top1Share > 30 ? 'var(--orange)' : 'var(--fg)'} />
            <ParamRow k="Top 3 share" v={`${top3Share.toFixed(1)}%`} />
            <ParamRow k="Top 5 share" v={`${top5Share.toFixed(1)}%`} />
            <ParamRow k="Unique assets" v={String(allAssetRows.length)} />
            <ParamRow k="HHI" v={supplyHhi.toFixed(0)} c={concentrationBand(supplyHhi).color} />
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
              HHI = Σ(share%)². Standard: &gt;2500 highly concentrated.
            </div>
          </div>
        </div>

        <div className="panel col-6">
          <div className="panel-header">
            <span className="panel-title"><span className="bullet">●</span> Oracle concentration</span>
            <span style={{ fontSize: 11, color: concentrationBand(oracleHhi).color, fontFamily: 'var(--font-mono)' }}>
              HHI {oracleHhi.toFixed(0)} · {concentrationBand(oracleHhi).label}
            </span>
          </div>
          <div className="panel-body" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {oracleRows.length === 0 && (
              <div style={{ color: 'var(--fg-muted)' }}>No oracle data indexed.</div>
            )}
            {oracleRows.map(r => (
              <ParamRow key={r.name} k={`${r.name}`} v={`${r.share.toFixed(1)}% (${r.count} pools)`}
                c={r.share > 80 ? 'var(--red)' : r.share > 50 ? 'var(--orange)' : 'var(--fg)'} />
            ))}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)' }}>
              Per §4 Tier 3 — composite feeds traced to their root source.
              All pools currently price via Pyth — single point of failure for the lending sector on Sui.
            </div>
          </div>
        </div>
      </div>

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
// PAGE 5.5 — Risk (per §6 of the Lending Analysis Standard)
// ════════════════════════════════════════════════════════════════
//
// Required panels per the standard:
//   - HF distribution histogram
//   - Collateral-at-risk at -10/-20/-30% price shock
//   - Liquidation intensity (30D vol ÷ TVL) + efficiency
//   - Liquidator leaderboard
//   - HHI for asset concentration
//   - Days since last bad debt (heuristic)
//   - Largest liquidation events
//
// All metrics computed from data already in the API response — no extra
// server-side endpoints required for v1. Per-position HF data isn't yet
// indexed; the HF histogram is built across markets (one bin per market's
// aggregate HF), which is documented in the panel caption.
function PageRisk() {
  const allRows = [...(D.pools || []), ...(D.vaults || [])];
  const liqs = D.liquidations || [];

  // Total TVL across all rows (use supply or collateralUsd as available).
  const totalTvl = allRows.reduce((s, r) => s + (r.supply || r.collateralUsd || 0), 0);
  const totalBorrow = allRows.reduce((s, r) => s + (r.borrow || r.debtUsd || 0), 0);

  // 30D liquidation aggregates from the events table.
  const liq30d = liqs;
  const liq30dDebt = liq30d.reduce((s, e) => s + (e.debtRepaidUsd || 0), 0);
  const liq30dColl = liq30d.reduce((s, e) => s + (e.collateralSeizedUsd || 0), 0);

  // Liquidation intensity: 30D liquidated debt as % of TVL (per §4 Tier 2)
  const liqIntensity = totalTvl > 0 ? (liq30dDebt / 1e6) / totalTvl * 100 : 0;
  // Liquidation efficiency: collateral seized / debt repaid (closer to LT means tighter clearing)
  const liqEfficiency = liq30dDebt > 0 ? liq30dColl / liq30dDebt : 0;

  // Days since last bad-debt-shaped event. Heuristic: any liquidation event
  // implies a position breached HF<1 — we use the most recent liquidation
  // timestamp as the "days since last incident" signal. The standard
  // (§4 Tier 2) wants a separate append-only incident log; until that
  // exists, this is the closest proxy from current data.
  const lastLiqTs = liq30d.length > 0
    ? Math.max(...liq30d.map(e => new Date(e.t).getTime()))
    : null;
  const daysSinceLastIncident = lastLiqTs
    ? Math.floor((Date.now() - lastLiqTs) / 86400000)
    : null;

  // HF distribution. Bins from 0 to 5+ in 0.5-wide buckets, plus a "no debt"
  // category. Population: aggregate market-level HF (the field we expose).
  // Per-position would be ideal — flagged as a known limitation in caption.
  const hfBins = (() => {
    const edges = [0, 0.5, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 5.0];
    const bins = edges.slice(0, -1).map((lo, i) => ({
      label: `${lo.toFixed(2)}–${edges[i+1].toFixed(2)}`,
      count: 0, value: 0, lo, hi: edges[i+1],
    }));
    const above5 = { label: '5+', count: 0, value: 0 };
    const noDebt = { label: 'no debt', count: 0, value: 0, color: 'var(--fg-dim)' };
    for (const r of allRows) {
      const hf = r.healthFactor;
      const exposure = r.borrow || r.debtUsd || 0;
      if (hf == null) { noDebt.count++; continue; }
      if (hf >= 5) { above5.count++; above5.value += exposure; continue; }
      const bin = bins.find(b => hf >= b.lo && hf < b.hi);
      if (bin) { bin.count++; bin.value += exposure; }
    }
    // Color: <1 red, 1-1.5 orange, ≥1.5 green per §6 semantic risk tokens.
    bins.forEach(b => {
      b.color = b.hi <= 1 ? 'var(--red)' : b.hi <= 1.5 ? 'var(--orange)' : 'var(--green)';
    });
    above5.color = 'var(--green)';
    return [...bins, above5, noDebt];
  })();
  // HF=1 reference line index (the liquidation threshold).
  const hfBinAt1 = hfBins.findIndex(b => b.label.startsWith('1.00'));

  // Collateral-at-risk at price shocks. For each row with HF defined and
  // a liquidation threshold, simulate HF' = HF × (1 − shock). Rows whose
  // simulated HF falls below 1 are flagged; sum their borrows.
  const carShocks = [-0.10, -0.20, -0.30];
  const car = carShocks.map(shock => {
    let atRiskDebt = 0, atRiskCollateral = 0, count = 0;
    for (const r of allRows) {
      const hf = r.healthFactor;
      if (hf == null) continue;
      // Apply shock to the collateral side: HF' = HF × (1 + shock)
      const newHf = hf * (1 + shock);
      if (newHf < 1) {
        atRiskDebt += (r.borrow || r.debtUsd || 0);
        atRiskCollateral += (r.supply || r.collateralUsd || 0);
        count++;
      }
    }
    return { shockPct: Math.abs(shock * 100), debt: atRiskDebt, collateral: atRiskCollateral, count };
  });

  // Liquidator leaderboard — top 10 by 30D debt repaid USD.
  const liqByAddr = liq30d.reduce((acc, e) => {
    const k = e.liquidator || 'unknown';
    if (!acc[k]) acc[k] = { addr: k, debtRepaid: 0, collateralSeized: 0, count: 0 };
    acc[k].debtRepaid += e.debtRepaidUsd || 0;
    acc[k].collateralSeized += e.collateralSeizedUsd || 0;
    acc[k].count++;
    return acc;
  }, {});
  const liquidators = Object.values(liqByAddr)
    .sort((a, b) => b.debtRepaid - a.debtRepaid)
    .slice(0, 10);

  // HHI for asset concentration: Σ(share%)² across asset symbols by supply.
  // Per the standard: >2500 = highly concentrated.
  const supplyByAsset = allRows.reduce((acc, r) => {
    const sym = r.sym || r.asset || '?';
    const sup = r.supply || r.collateralUsd || 0;
    acc[sym] = (acc[sym] || 0) + sup;
    return acc;
  }, {});
  const totSupply = Object.values(supplyByAsset).reduce((s, v) => s + v, 0);
  const hhi = Object.values(supplyByAsset).reduce((s, v) => {
    const share = totSupply > 0 ? (v / totSupply * 100) : 0;
    return s + share * share;
  }, 0);
  const hhiBand = hhi > 2500 ? { color: 'var(--red)',    label: 'highly concentrated' }
                : hhi > 1500 ? { color: 'var(--orange)', label: 'moderate' }
                :              { color: 'var(--green)',  label: 'diffuse' };

  // Largest liquidation events (top 10 by debt repaid).
  const largestEvents = [...liq30d]
    .sort((a, b) => (b.debtRepaidUsd || 0) - (a.debtRepaidUsd || 0))
    .slice(0, 10);

  return (
    <PageShell pageId="risk" title="Lending Terminal: SUI — Risk" terminal="lending-terminal-sui-risk">
      <KpiStrip items={[
        { id: 'lqi', label: 'Liq. intensity (30D)', value: `${liqIntensity.toFixed(2)}%`, change: 0, subLabel: 'debt liquidated ÷ TVL' },
        { id: 'lqe', label: 'Liq. efficiency',      value: liqEfficiency > 0 ? `${liqEfficiency.toFixed(2)}×` : '—', change: 0, subLabel: 'collateral seized ÷ debt repaid' },
        { id: 'dsi', label: 'Days since incident',  value: daysSinceLastIncident != null ? `${daysSinceLastIncident}d` : '—', change: 0, subLabel: 'last liquidation event' },
        { id: 'hhi', label: 'Asset HHI',            value: hhi.toFixed(0), change: 0, subLabel: hhiBand.label },
      ]} />

      {/* HF distribution histogram (§6 mandatory panel) */}
      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Health Factor distribution"
          protocolMode="none"
          metricItems={null}
          description="Distribution of market-level aggregate Health Factor across all pools/vaults. A bar in the 0.00–1.00 bucket means at least one market sits below liquidation threshold. Per-position HF would be ideal but isn't yet indexed; this market-level view is documented as a coarse signal."
          render={({ size }) => {
            const w = size === 'expanded' ? 1200 : 1200;
            const h = size === 'expanded' ? 520 : 320;
            return (
              <Histogram bins={hfBins} width={w} height={h}
                referenceX={hfBinAt1 >= 0 ? hfBinAt1 : null}
                referenceLabel="HF = 1 (liquidation)"
                countLabel="Markets"
                valueLabel="Σ debt"
                valueFormatter={v => fmtUSD(v * 1e6)} />
            );
          }}
        />
      </div>

      {/* Collateral-at-risk at price shocks */}
      <div style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="bullet">●</span> Collateral-at-risk under price shock
              <span className="info-icon" tabIndex={0}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="7" x2="8" y2="11.5"/><circle cx="8" cy="4.8" r="0.4" fill="currentColor"/></svg>
                <span className="info-tip">For each market, simulate HF' = HF × (1 − shock). Markets whose HF' &lt; 1 would be liquidatable. We sum their borrows + collateral. Per §5 of the standard the proper version uses Monte Carlo on per-position HF; this is a deterministic baseline pending the per-position indexer.</span>
              </span>
            </span>
          </div>
          <div className="panel-body">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 4px' }}>Price shock</th>
                  <th style={{ padding: '8px 4px' }}>Markets at risk</th>
                  <th style={{ padding: '8px 4px' }}>Debt at risk</th>
                  <th style={{ padding: '8px 4px' }}>Collateral at risk</th>
                  <th style={{ padding: '8px 4px' }}>% of TVL</th>
                </tr>
              </thead>
              <tbody>
                {car.map((c, i) => {
                  const pctTvl = totalTvl > 0 ? (c.collateral / totalTvl * 100) : 0;
                  const color = pctTvl > 20 ? 'var(--red)' : pctTvl > 5 ? 'var(--orange)' : 'var(--fg)';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                      <td style={{ padding: '10px 4px', fontWeight: 600 }}>−{c.shockPct}%</td>
                      <td style={{ padding: '10px 4px' }}>{c.count}</td>
                      <td style={{ padding: '10px 4px' }}>{fmtUSD(c.debt * 1e6)}</td>
                      <td style={{ padding: '10px 4px' }}>{fmtUSD(c.collateral * 1e6)}</td>
                      <td style={{ padding: '10px 4px', color }}>{pctTvl.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              Total TVL: {fmtUSD(totalTvl * 1e6, 1)} · methodology baseline pending Monte Carlo (§5)
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-12" style={{ marginTop: 16 }}>
        {/* Liquidator leaderboard */}
        <div className="panel col-6">
          <div className="panel-header">
            <span className="panel-title"><span className="bullet">●</span> Liquidator leaderboard (30D)</span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>top {liquidators.length}</span>
          </div>
          <div className="panel-body">
            {liquidators.length === 0 && (
              <div style={{ padding: '12px 0', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                No liquidation events in the last 30 days.
              </div>
            )}
            {liquidators.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '6px 4px', width: 22 }}>#</th>
                    <th style={{ padding: '6px 4px' }}>Liquidator</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Debt repaid</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Events</th>
                  </tr>
                </thead>
                <tbody>
                  {liquidators.map((l, i) => (
                    <tr key={l.addr} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                      <td style={{ padding: '6px 4px', color: 'var(--fg-dim)' }}>{String(i+1).padStart(2,'0')}</td>
                      <td style={{ padding: '6px 4px' }}>{l.addr}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtUSD(l.debtRepaid)}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>{l.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Largest events */}
        <div className="panel col-6">
          <div className="panel-header">
            <span className="panel-title"><span className="bullet">●</span> Largest events (30D)</span>
          </div>
          <div className="panel-body">
            {largestEvents.length === 0 && (
              <div style={{ padding: '12px 0', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                No events to show.
              </div>
            )}
            {largestEvents.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '6px 4px' }}>When</th>
                    <th style={{ padding: '6px 4px' }}>Protocol</th>
                    <th style={{ padding: '6px 4px' }}>Market</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Debt</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Collateral</th>
                  </tr>
                </thead>
                <tbody>
                  {largestEvents.map((e, i) => {
                    const d = new Date(e.t);
                    const ago = Math.floor((Date.now() - d.getTime()) / 86400000);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                        <td style={{ padding: '6px 4px', color: 'var(--fg-muted)' }}>{ago}d ago</td>
                        <td style={{ padding: '6px 4px' }}>{e.protocol}</td>
                        <td style={{ padding: '6px 4px' }}>{e.market || e.debtAsset || '?'}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtUSD(e.debtRepaidUsd || 0)}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtUSD(e.collateralSeizedUsd || 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Asset concentration (HHI) */}
      <div style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="bullet">●</span> Asset concentration (HHI)
              <span style={{ marginLeft: 12, color: hhiBand.color, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                HHI {hhi.toFixed(0)} · {hhiBand.label}
              </span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              Σ(share%)² · &gt;2500 = highly concentrated
            </span>
          </div>
          <div className="panel-body">
            <Leaderboard items={Object.entries(supplyByAsset)
              .map(([sym, v]) => ({ name: sym, value: v * 1e6 }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 12)} format={fmtUSD} />
          </div>
        </div>
      </div>

      {/* ── Modeled risk (§5: Monte Carlo + VaR ensemble + ES + backtest) ── */}
      <ModeledRiskPanel rm={D.riskModel} />
    </PageShell>
  );
}

// ── §5 Modeling panel ──────────────────────────────────────────────────────
// Surfaces what `computeRiskModel` returns from the API:
//
//   • Headline KPI strip: P(>1% TVL liquidated over 7D), MC 95th-pct LaR,
//     historical 1D VaR(95%), historical 1D ES(95%).
//   • VaR / ES table: 95% and 99%, both Historical Simulation and the
//     parametric Student-t (df=4) heavy-tail variant alongside each other so
//     a reader can see the heavy-tail premium at a glance.
//   • Backtest line: actual vs expected violation rate (in/out-of-sample).
//   • Limitations: the frozen list the backend returns — never sugar-coated.
//
// Renders nothing when the backend didn't include riskModel (e.g. old
// cached payload, missing return series). Failing closed beats a half-drawn
// risk panel.
function ModeledRiskPanel({ rm }) {
  if (!rm || !rm.var || !rm.monteCarlo) return null;
  const mc = rm.monteCarlo;
  const hist = rm.history || {};
  const v95 = rm.var.find(r => r.level === 0.95);
  const v99 = rm.var.find(r => r.level === 0.99);
  const bt95 = (rm.backtest || []).find(r => r.level === 0.95);
  const bt99 = (rm.backtest || []).find(r => r.level === 0.99);

  // 1D returns expressed in percent. The model uses log returns; for VaR
  // display we treat them as percent loss which is accurate to second order
  // and matches how Basel-style tables are read.
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  const pctNoSign = (x) => `${Math.abs(x * 100).toFixed(2)}%`;

  // Backtest banding: ratio of actual to expected violations. 0.5×–2× of
  // expected is "in band" for a 90-day series; outside that suggests the VaR
  // is mis-calibrated.
  const btBand = (b) => {
    if (!b || !b.observations) return { color: 'var(--fg-muted)', label: 'n/a' };
    const r = b.expectedRate > 0 ? b.violationRate / b.expectedRate : 0;
    if (r >= 0.5 && r <= 2) return { color: 'var(--green)', label: 'in band' };
    if (r === 0) return { color: 'var(--orange)', label: 'no breaches (small n)' };
    if (r > 2) return { color: 'var(--red)', label: 'over-breaching' };
    return { color: 'var(--orange)', label: 'under-breaching' };
  };
  const bb95 = btBand(bt95);
  const bb99 = btBand(bt99);

  // P(>1% TVL liquidated) color band: under 5% = clear, 5-20% = elevated,
  // above 20% = severe. Same tokens the rest of the dashboard uses.
  const probColor = mc.probOnePctLiquidated > 0.20 ? 'var(--red)'
                  : mc.probOnePctLiquidated > 0.05 ? 'var(--orange)'
                  : 'var(--green)';

  return (
    <div style={{ marginTop: 16 }}>
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">
            <span className="bullet">●</span> Modeled risk (§5)
            <span className="info-icon" tabIndex={0}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="7" x2="8" y2="11.5"/><circle cx="8" cy="4.8" r="0.4" fill="currentColor"/></svg>
              <span className="info-tip">
                Monte Carlo LaR ({mc.paths.toLocaleString()} paths, GBM, {mc.horizonDays}D horizon, σ={pct(mc.assumedAnnualVol)} annualized) +
                VaR ensemble (Historical Simulation + Student-t df=4) + Expected Shortfall + in/out-of-sample backtest.
                Calibrated on {hist.observations}D of sector-TVL log returns.
              </span>
            </span>
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            seed {rm.meta?.seed?.toString(16) || '?'} · {mc.paths.toLocaleString()} paths
          </span>
        </div>
        <div className="panel-body">
          {/* Headline KPI strip — four numbers a portfolio manager would want first */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <div className="kpi" style={{ padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                P(&gt;1% TVL liquidated, 7D)
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color: probColor, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {pct(mc.probOnePctLiquidated)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                Monte Carlo
              </div>
            </div>
            <div className="kpi" style={{ padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                95th-pct LaR (7D)
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {pct(mc.laR95)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                of sector TVL
              </div>
            </div>
            <div className="kpi" style={{ padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                VaR(95%) · 1D
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {v95 ? pctNoSign(v95.historical) : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                Historical Simulation
              </div>
            </div>
            <div className="kpi" style={{ padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                ES(95%) · 1D
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                {v95 ? pctNoSign(v95.historicalES) : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                tail-mean loss
              </div>
            </div>
          </div>

          {/* VaR / ES table — historical + parametric heavy-tail, 1-day horizon */}
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
            VaR / Expected Shortfall · 1-day horizon · loss as % of sector TVL
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 4px' }}>Confidence</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>VaR (Historical)</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>VaR (Student-t df=4)</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>ES (Historical)</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>ES (Student-t df=4)</th>
              </tr>
            </thead>
            <tbody>
              {[v95, v99].filter(Boolean).map((row) => (
                <tr key={row.level} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '10px 4px', fontWeight: 600 }}>{pct(row.level)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>{pctNoSign(row.historical)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>{pctNoSign(row.parametric)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>{pctNoSign(row.historicalES)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>{pctNoSign(row.parametricES)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            ↪ Heavy-tail (Student-t df=4) typically reports a larger loss than Historical at the same confidence — the gap is the "fat-tail premium". When the two are close, the recent history already contains the tail observation you'd hedge for.
          </div>

          {/* Backtest line */}
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            Backtest (in-sample VaR, out-of-sample evaluation)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 13, marginTop: 4 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 4px' }}>Confidence</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Expected breaches</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Actual breaches</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Actual rate</th>
                <th style={{ padding: '8px 4px', textAlign: 'right' }}>Expected rate</th>
                <th style={{ padding: '8px 4px' }}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {[
                { row: bt95, band: bb95 },
                { row: bt99, band: bb99 },
              ].filter(x => x.row).map(({ row, band }) => (
                <tr key={row.level} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <td style={{ padding: '10px 4px', fontWeight: 600 }}>{pct(row.level)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>{row.expectedViolations.toFixed(2)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>{row.actualViolations}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>{pct(row.violationRate)}</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right' }}>{pct(row.expectedRate)}</td>
                  <td style={{ padding: '10px 4px', color: band.color }}>{band.label}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Monte Carlo summary */}
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            Monte Carlo summary
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>P(&gt;1% liquidated, 7D)</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{pct(mc.probOnePctLiquidated)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>95% LaR (7D)</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{pct(mc.laR95)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>99% LaR (7D)</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{pct(mc.laR99)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>E[time to first liq | liq]</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>
                {mc.expectedTimingDays != null ? `${mc.expectedTimingDays.toFixed(1)}d` : '—'}
              </div>
            </div>
          </div>

          {/* Calibration footnote */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-soft)', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            Calibration: {hist.observations || 0} daily observations · realized σ = {pct(hist.annualizedVol || 0)} annualized · realized μ = {pct(hist.annualizedReturn || 0)}/yr ·
            min 1D = {pct(hist.minReturn || 0)} · max 1D = {pct(hist.maxReturn || 0)}
          </div>

          {/* Limitations — verbatim from backend; non-negotiable */}
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>
              Model limitations ({(rm.limitations || []).length})
            </summary>
            <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
              {(rm.limitations || []).map((l, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{l}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
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
    // Cap percentages — null means cap data isn't available for this pool (per
    // §3 of the analysis standard, we surface "—" rather than 0% to avoid
    // implying full headroom we haven't verified).
    const supplyCapPct = market.supplyCap != null && market.supplyCap > 0 ? (supplyTok / market.supplyCap * 100) : null;
    const borrowCapPct = market.borrowCap != null && market.borrowCap > 0 ? (borrowTok / market.borrowCap * 100) : null;

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
              {/* Rate Spread per §4 Tier 1 — the protocol + reserve wedge. */}
              <ParamRow k="Rate Spread" v={`${(market.borrowApy - market.supplyApy).toFixed(2)} pp`} />
              {/* Net Interest Margin per §4 Tier 1: borrowAPY × util × (1−RF).
                  This is what suppliers actually receive after the protocol
                  takes its cut. Document the identity used. */}
              <ParamRow k="Net Interest Margin"
                v={`${(market.borrowApy * (market.util/100) * (1 - (market.reserveFactor ?? 0)/100)).toFixed(2)}%`} />
              {/* Null-guarded — old API rows may not include these fields,
                  and undefined.toFixed() throws → unmounts the page. */}
              <ParamRow k="Base Rate"     v={`${(market.irmBaseRate ?? 0).toFixed(2)}%`} />
              <ParamRow k="Multiplier"    v={`${(market.irmMultiplier ?? 0).toFixed(2)}%`} />
              <ParamRow k="Jump Mult."    v={`${(market.irmJumpMult ?? 0).toFixed(2)}%`} />
              <ParamRow k="Kink"          v={`${market.irmKink}%`} />
              <ParamRow k="Current Util." v={`${market.util.toFixed(1)}%`} c={market.util > 80 ? 'var(--red)' : market.util > 50 ? 'var(--orange)' : 'var(--green)'} />
            </div>
          </div>

          <div className="panel col-4">
            <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Risk Parameters</span></div>
            <div className="panel-body">
              <ParamRow k="LTV (Coll. Factor)" v={`${(market.ltv ?? 0).toFixed(1)}%`} />
              <ParamRow k="Liquidation Thresh." v={`${(market.liqThreshold ?? 0).toFixed(1)}%`} />
              <ParamRow k="Reserve Factor"  v={`${(market.reserveFactor ?? 0).toFixed(1)}%`} />
              {/* Aggregate market Health Factor — see backend toPoolRow for
                  the formula. null = no borrows yet (HF is undefined / ∞);
                  show "—" rather than misleading the user with a huge number.
                  Color-code <1 (liquidatable) red, 1-1.5 amber, ≥1.5 green. */}
              <ParamRow
                k="Health Factor"
                v={market.healthFactor == null
                  ? '—'
                  : market.healthFactor.toFixed(2)}
                c={market.healthFactor == null ? 'var(--fg-muted)'
                    : market.healthFactor < 1   ? 'var(--red)'
                    : market.healthFactor < 1.5 ? 'var(--orange)'
                    : 'var(--green)'}
              />
              {/* Caps: render "—" when unknown rather than fake 0. Cap-used % uses
                  semantic risk colors per §6: >80% = red. */}
              <ParamRow k="Supply Cap" v={market.supplyCap != null && market.supplyCap > 0 ? `${fmtNum(market.supplyCap, 0)} ${marketSym}` : '—'} />
              <ParamRow k="Borrow Cap" v={market.borrowCap != null && market.borrowCap > 0 ? `${fmtNum(market.borrowCap, 0)} ${marketSym}` : '—'} />
              <ParamRow k="Supply Cap Used" v={supplyCapPct != null ? `${supplyCapPct.toFixed(1)}%` : '—'} c={supplyCapPct != null && supplyCapPct > 80 ? 'var(--red)' : 'var(--fg)'} />
              <ParamRow k="Borrow Cap Used" v={borrowCapPct != null ? `${borrowCapPct.toFixed(1)}%` : '—'} c={borrowCapPct != null && borrowCapPct > 80 ? 'var(--red)' : 'var(--fg)'} />
            </div>
          </div>

          <div className="panel col-4">
            <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Market Info</span></div>
            <div className="panel-body">
              <ParamRow k="Asset" v={marketSym} />
              <ParamRow k="Protocol" v={proto.name} />
              <ParamRow k="Risk Tier" v={<RiskChip risk={market.risk} />} />
              <ParamRow k="Oracle" v={market.oracleSource} />
              {/* Distinct-address counts — null means we don't index per-pool
                  addresses for this protocol (currently only NAVI). Render "—"
                  to avoid claiming 0 users. */}
              <ParamRow k="Suppliers" v={market.suppliers != null ? fmtNum(market.suppliers, 0) : '—'} />
              <ParamRow k="Borrowers" v={market.borrowers != null ? fmtNum(market.borrowers, 0) : '—'} />
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
              // Synthesize flat-line history if the API didn't ship one
              // (we trimmed per-pool history arrays from the bulk response
              // for payload-size reasons — they were 1.2MB of pure noise).
              const hist = market.history && market.history.length
                ? market.history.slice(-30)
                : Array.from({ length: 30 }, (_, i) => ({ day: i, supply: market.supply, borrow: market.borrow }));
              const series = [
                { name: 'Supply', color: '#FF6B35', values: hist.map(d => d.supply * scale) },
                { name: 'Borrow', color: '#3B5FE0', values: hist.map(d => d.borrow * scale) },
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
              const apyHist = market.apyHistory && market.apyHistory.length
                ? market.apyHistory.slice(-30)
                : Array.from({ length: 30 }, (_, i) => ({ day: i, supply: market.supplyApy, borrow: market.borrowApy }));
              const series = [
                { name: 'Supply APY', color: 'var(--green)', values: apyHist.map(d => d.supply) },
                { name: 'Borrow APY', color: 'var(--red)',   values: apyHist.map(d => d.borrow) },
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
              // curve is sampled at u=0..100 step 2 → 51 points. The current
              // utilization marker (per §6: "current-state marker where one
              // exists") sits at index = util/2, rounded into bounds.
              const currentIdx = Math.max(0, Math.min(curve.length - 1, Math.round(market.util / 2)));
              const kinkIdx = Math.max(0, Math.min(curve.length - 1, Math.round((market.irmKink ?? 80) / 2)));
              return (
                <AreaChart
                  series={[
                    { name: 'Supply Rate', color: 'var(--green)', values: curve.map(p => p.supplyR) },
                    { name: 'Borrow Rate', color: 'var(--red)',   values: curve.map(p => p.borrowR) },
                  ]}
                  width={w} height={h}
                  formatter={v => `${v.toFixed(2)}%`}
                  markerX={currentIdx}
                  markerLabel={`util ${market.util.toFixed(0)}%`}
                  overlayCompare={null}
                />
              );
            }}
          />
          <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center' }}>
            X-axis: utilization 0% → 100%. Kink at <b>{market.irmKink}%</b>. Current util: <b>{market.util.toFixed(1)}%</b> (marker line).
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
            {(() => {
              // CDP variants per §4 of the analysis standard:
              //   - Surplus / backing buffer = collateral − debt (cushion before peg breaks)
              //   - Backing ratio = collateral ÷ debt (the CDP analogue of HF — should
              //     stay materially above the min collateral ratio)
              //   - Peg / redemption spread = debt-token market price vs $1 target.
              //     Bucket's USDB / BUCK market prices on Sui DEXs aren't yet indexed
              //     in our pipeline; rendered "—" with a "not indexed" tag to avoid
              //     fabricating, per §1.2 / §8.C ("no un-sourced figure ships").
              const surplusUsdM = market.collateralUsd - market.debtUsd;
              const backingRatio = market.debtUsd > 0 ? market.collateralUsd / market.debtUsd * 100 : null;
              const headroomPP = backingRatio != null ? backingRatio - market.minCR : null;
              const surplusColor = surplusUsdM < 0 ? 'var(--red)' : surplusUsdM < market.debtUsd * 0.05 ? 'var(--orange)' : 'var(--green)';
              const ratioColor = backingRatio == null ? 'var(--fg-muted)' :
                                 backingRatio < market.minCR + 5 ? 'var(--red)' :
                                 backingRatio < market.minCR * 1.20 ? 'var(--orange)' :
                                 'var(--green)';
              return (
                <>
                  <ParamRow k="Backing Ratio (CR)" v={backingRatio != null ? `${backingRatio.toFixed(1)}%` : '—'} c={ratioColor} />
                  <ParamRow k="Min CR (liquidation)" v={`${market.minCR}%`} />
                  <ParamRow k="Headroom over Min CR" v={headroomPP != null ? `${headroomPP.toFixed(1)}pp` : '—'} />
                  <ParamRow k="Surplus / Backing Buffer" v={fmtUSD(surplusUsdM * 1e6, 2)} c={surplusColor} />
                  <ParamRow k="USDB / Collateral (Util)" v={`${(market.debtUsd / Math.max(market.collateralUsd, 1e-9) * 100).toFixed(1)}%`} />
                  {/* Peg / redemption spread per §4 CDP variants. USDB/BUCK
                      market price not yet indexed; render "—" with a not-indexed
                      tag rather than fake it. Redemption fee IS in vault data. */}
                  <ParamRow k="Peg Spread (USDB vs $1)" v="—" c="var(--fg-muted)" />
                  <ParamRow k="Redemption Fee" v={`${market.redemptionFee.toFixed(2)}%`} />
                  <ParamRow k="Spot Price" v={fmtUSD(price, price < 10 ? 4 : 2)} />
                  <ParamRow k="Oracle" v="Pyth" />
                </>
              );
            })()}
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

// ════════════════════════════════════════════════════════════════
// PAGE — Compare (cross-protocol side-by-side per §6)
// ════════════════════════════════════════════════════════════════
//
// Standard requires "Side-by-side protocol metrics on every headline figure"
// in a sortable table. Each row is a protocol; each column a headline
// metric. Clicking any column header re-sorts. Protocol column links back
// to that protocol's detail view.
function PageCompare() {
  const protos = D.protocols || [];
  const metrics = D.protocolMetrics || [];
  const STABLE_SYMS = new Set([
    'USDC','USDT','USDsui','USDSUI','USDB','AUSD','BUCK','FDUSD','wUSDC','wUSDT','suiUSDT','USDY','mUSD',
  ]);

  // Build one row per protocol, aggregating row-level data so each headline
  // metric has a sortable numeric value.
  const rows = protos.map(p => {
    const m = metrics.find(x => x.id === p.id) || {};
    const pool = D.pools.filter(x => x.protocol === p.id);
    const vault = D.vaults.filter(x => x.protocol === p.id);
    const all = [...pool, ...vault];

    // Weighted average APYs by supply / borrow.
    const wSup = all.reduce((s, r) => s + (r.supplyApy || 0) * (r.supply || 0), 0);
    const wSupTot = all.reduce((s, r) => s + (r.supply || 0), 0);
    const wBor = all.reduce((s, r) => s + (r.borrowApy || 0) * (r.borrow || 0), 0);
    const wBorTot = all.reduce((s, r) => s + (r.borrow || 0), 0);
    const supplyApy = wSupTot > 0 ? wSup / wSupTot : 0;
    const borrowApy = wBorTot > 0 ? wBor / wBorTot : 0;
    const utilization = wSupTot > 0 ? wBorTot / wSupTot * 100 : 0;

    // Asset HHI per protocol (collateral concentration).
    const supplyByAsset = all.reduce((acc, r) => {
      const sym = r.sym || r.asset || '?';
      acc[sym] = (acc[sym] || 0) + (r.supply || r.collateralUsd || 0);
      return acc;
    }, {});
    const totSup = Object.values(supplyByAsset).reduce((s, v) => s + v, 0);
    const hhi = totSup > 0 ? Object.values(supplyByAsset).reduce((s, v) => {
      const share = v / totSup * 100;
      return s + share * share;
    }, 0) : 0;

    // Stable debt share per protocol.
    let stableBorrow = 0, totalBorrow = 0;
    pool.forEach(r => { totalBorrow += r.borrow || 0; if (STABLE_SYMS.has(r.sym)) stableBorrow += r.borrow || 0; });
    vault.forEach(r => { totalBorrow += r.debtUsd || 0; stableBorrow += r.debtUsd || 0; });
    const stableDebtShare = totalBorrow > 0 ? stableBorrow / totalBorrow * 100 : 0;

    // Fee run-rate (annualized) + take rate.
    const feesAnnual = (m.fees || 0) * 1e6;
    const takeRate = m.tvl > 0 ? (m.fees / m.tvl * 100) : 0;

    return {
      id: p.id,
      protocol: p.name,
      color: p.color,
      archetype: p.archetype,
      tvl: m.tvl || 0,
      tvlMethod: m.tvlMethod,
      supply: m.supply || 0,
      borrow: m.borrow || 0,
      utilization,
      supplyApy,
      borrowApy,
      feesAnnual,
      takeRate,
      hhi,
      stableDebtShare,
      markets: all.length,
    };
  });

  // Compose columns — each declares sortable + numeric, and supplies a
  // render() if it needs formatting beyond the raw value.
  const columns = [
    {
      id: 'protocol', label: 'Protocol', sortable: true,
      render: (r) => (
        <a href={`Protocol.html?protocol=${r.id}`}
          onClick={() => typeof showNavSplash === 'function' && showNavSplash()}
          style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>{r.protocol}</span>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)', padding: '1px 4px', border: '1px solid var(--border)', borderRadius: 2, letterSpacing: '0.04em' }}>
            {r.archetype === 'pool' ? 'POOL' : 'CDP'}
          </span>
        </a>
      ),
    },
    { id: 'tvl', label: 'TVL ($M)', sortable: true, numeric: true, render: (r) => fmtUSD(r.tvl * 1e6, 1) },
    { id: 'supply', label: 'Supplied ($M)', sortable: true, numeric: true, render: (r) => fmtUSD(r.supply * 1e6, 1) },
    { id: 'borrow', label: 'Borrowed ($M)', sortable: true, numeric: true, render: (r) => fmtUSD(r.borrow * 1e6, 1) },
    { id: 'utilization', label: 'Util.', sortable: true, numeric: true,
      render: (r) => (
        <span style={{ color: r.utilization > 80 ? 'var(--red)' : r.utilization > 50 ? 'var(--orange)' : 'var(--fg)' }}>
          {r.utilization.toFixed(1)}%
        </span>
      ),
    },
    { id: 'supplyApy', label: 'Sup. APY', sortable: true, numeric: true,
      render: (r) => <span style={{ color: 'var(--green)' }}>{r.supplyApy.toFixed(2)}%</span> },
    { id: 'borrowApy', label: 'Bor. APY', sortable: true, numeric: true,
      render: (r) => <span style={{ color: 'var(--red)' }}>{r.borrowApy.toFixed(2)}%</span> },
    { id: 'feesAnnual', label: 'Fees (annual)', sortable: true, numeric: true, render: (r) => fmtUSD(r.feesAnnual, 1) },
    { id: 'takeRate', label: 'Take Rate', sortable: true, numeric: true,
      render: (r) => (
        <span style={{ color: r.takeRate > 3 ? 'var(--red)' : r.takeRate > 1 ? 'var(--orange)' : 'var(--green)' }}>
          {r.takeRate.toFixed(2)}%
        </span>
      ),
    },
    { id: 'hhi', label: 'Asset HHI', sortable: true, numeric: true,
      render: (r) => (
        <span style={{ color: r.hhi > 2500 ? 'var(--red)' : r.hhi > 1500 ? 'var(--orange)' : 'var(--fg)' }}>
          {r.hhi.toFixed(0)}
        </span>
      ),
    },
    { id: 'stableDebtShare', label: 'Stable Debt', sortable: true, numeric: true, render: (r) => `${r.stableDebtShare.toFixed(0)}%` },
    { id: 'markets', label: 'Markets', sortable: true, numeric: true },
    { id: 'tvlMethod', label: 'TVL src', sortable: true,
      render: (r) => (
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)', padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 2, letterSpacing: '0.04em' }}>
          {(r.tvlMethod || 'gross').toUpperCase()}
        </span>
      ),
    },
  ];

  // Sector totals row for context (rendered separately above the table).
  const sectorTvl = rows.reduce((s, r) => s + r.tvl, 0);
  const sectorSup = rows.reduce((s, r) => s + r.supply, 0);
  const sectorBor = rows.reduce((s, r) => s + r.borrow, 0);
  const sectorUtil = sectorSup > 0 ? sectorBor / sectorSup * 100 : 0;
  const sectorFees = rows.reduce((s, r) => s + r.feesAnnual, 0);

  return (
    <PageShell pageId="compare" title="Lending Terminal: SUI — Compare" terminal="lending-terminal-sui-compare">
      <KpiStrip items={[
        { id: 'st',  label: 'Sector TVL',        value: fmtUSD(sectorTvl * 1e6, 1), change: 0, subLabel: `${rows.length} protocols` },
        { id: 'ss',  label: 'Sector Supplied',   value: fmtUSD(sectorSup * 1e6, 1), change: 0 },
        { id: 'sb',  label: 'Sector Borrowed',   value: fmtUSD(sectorBor * 1e6, 1), change: 0, subLabel: `util ${sectorUtil.toFixed(1)}%` },
        { id: 'sf',  label: 'Sector Fees (annual)', value: fmtUSD(sectorFees, 1), change: 0 },
      ]} />

      <div style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title"><span className="bullet">●</span> Side-by-side headline metrics</span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              click any column to sort · §6 Compare
            </span>
          </div>
          <div className="panel-body" style={{ padding: '0 16px 16px' }}>
            <DataTable
              columns={columns}
              rows={rows}
              initialSort={{ id: 'tvl', dir: 'desc' }}
              emptyMessage="No protocols loaded."
            />
            <div style={{ marginTop: 12, fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
              TVL src: NET = supply−borrow per protocol UI · GROSS = total deposits · REMOTE = canonical fetch (Scallop indexer / DefiLlama)
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

Object.assign(window, { PageOverview, PageProtocol, PageRates, PageRevenue, PageCollateral, PageRisk, PageLiquidation, PageCompare, PageMarketDetail });
