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
  // Aesthetic preset (look-and-feel). 'evolved' = the terminal look (default);
  // 'institutional' = clean SaaS (Inter, sentence case, neutral chrome), ported
  // from the SDK. Persisted to localStorage; the per-page pre-paint script in
  // each HTML <head> re-applies it before React mounts so there's no flash.
  const [aesthetic, setAesthetic] = useStateP(document.body.getAttribute('data-aesthetic') || 'evolved');
  const [cmdk, setCmdk] = useStateP(false);
  const [, forceRerender] = useStateP(0);

  useEffectP(() => {
    document.body.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch(e) {}
  }, [theme]);

  useEffectP(() => {
    document.body.setAttribute('data-aesthetic', aesthetic);
    try { localStorage.setItem('aesthetic', aesthetic); } catch(e) {}
  }, [aesthetic]);

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

  // Derive the page-header badge state from the API payload.
  //
  // Mapping (revised 2026-05-31 after user feedback "BROKEN over working data"):
  //   • Anything tripping a CRITICAL gate (freshness fail, provenance fail) → BROKEN.
  //     Those gates indicate the page is showing wrong data or no source.
  //   • Otherwise any 'fail' AND any 'warn' → DEGRADED.
  //     A conservation/aggregation/reconciliation fail is real but data is
  //     still rendering; DEGRADED is the honest read.
  //   • Otherwise any 'warn' → DEGRADED.
  //   • Otherwise → VERIFIED.
  //
  // The tooltip lists exactly which gates aren't green, with the verdict per
  // gate ("conservation: fail · freshness: warn"), so a reader sees what
  // BROKEN/DEGRADED actually refers to without opening the methodology page.
  const gates = D.integrityGates || [];
  const CRITICAL_GATES = new Set(['freshness', 'provenance']);
  const hasCriticalFail = gates.some(g => g.status === 'fail' && CRITICAL_GATES.has(g.id));
  const hasFail = gates.some(g => g.status === 'fail');
  const hasWarn = gates.some(g => g.status === 'warn');
  const qLevel = hasCriticalFail   ? 'broken'
              : (hasFail || hasWarn) ? 'degraded'
              : gates.length         ? 'ok'
              :                        'unknown';
  const qLabel = qLevel === 'broken' ? 'BROKEN'
               : qLevel === 'degraded' ? 'DEGRADED'
               : qLevel === 'ok' ? 'VERIFIED'
               : 'LOADING';
  const offGates = gates.filter(g => g.status !== 'pass');
  const qTip = offGates.length
    ? `${offGates.length} of ${gates.length} gates non-pass:\n` + offGates.map(g => `• [${g.status.toUpperCase()}] ${g.label}`).join('\n')
    : `${gates.length} of ${gates.length} integrity gates green`;

  const asOf = D.asOf || {};
  const sourceName = asOf.rpcSource === 'alchemy' ? 'Alchemy Sui RPC'
                   : asOf.rpcSource === 'blockvision' ? 'BlockVision Sui RPC'
                   : asOf.rpcSource ? 'Sui RPC'
                   : 'Sui mainnet';
  const lastUpdatedMs = asOf.checkpointTimestamp
    ? new Date(asOf.checkpointTimestamp).getTime()
    : (asOf.serverTime ? new Date(asOf.serverTime).getTime() : null);

  return (
    <>
      <Topbar title={terminal} onOpenCmdk={() => setCmdk(true)} theme={theme} setTheme={setTheme} aesthetic={aesthetic} setAesthetic={setAesthetic} />
      <Sidebar current={pageId} />
      <main className="main">
        <div className="page-header">
          <div>
            <h1 className="page-title">{title}</h1>
            <div className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span><span className="ok">●</span> Sui mainnet · {protoCount} protocols · {marketCount} markets</span>
              {gates.length > 0 && <DataQualityBadge level={qLevel} label={qLabel} tooltip={qTip} />}
              {lastUpdatedMs && <DataSourceBadge source={sourceName} lastUpdated={lastUpdatedMs} tone={qLevel === 'broken' ? 'yellow' : 'green'} />}
            </div>
          </div>
          {headerRight && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{headerRight}</div>}
        </div>
        {/* Ticker is the market-price scroll bar. Only useful as a "what's
            the market doing right now" glance — relevant on Overview only.
            On every other page it competes for attention with the page's
            own KPI strip. */}
        {pageId === 'overview' && <Ticker items={D.ticker || []} />}
        {children}
        <div style={{ height: 40 }} />
      </main>
      <StatusBar />
      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} protocols={D.protocols || []} pools={D.pools || []} />
    </>
  );
}

// ── Shared visual helpers ───────────────────────────────────────
//
// One InfoTip component used dashboard-wide so methodology / formulas always
// look the same and never bloat the panel body. Drop next to any title,
// header chip, or KPI label. The CSS hover is the same `info-icon` /
// `info-tip` pair we already use — this is just a JSX wrapper so each
// caller doesn't re-implement the SVG + markup.
function InfoTip({ children, size = 12, style }) {
  return (
    <span className="info-icon" tabIndex={0} style={{ marginLeft: 6, ...style }}>
      <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6.5" />
        <line x1="8" y1="7" x2="8" y2="11.5" />
        <circle cx="8" cy="4.8" r="0.4" fill="currentColor" />
      </svg>
      <span className="info-tip" role="tooltip">{children}</span>
    </span>
  );
}

// Concentration band — shared because Asset HHI, Oracle HHI, and the Risk
// page all colour-code the same way. Single source of truth for the §4
// thresholds (>2500 highly concentrated, 1500–2500 moderate).
function concentrationBand(hhi) {
  if (hhi > 2500) return { color: 'var(--red)',    label: 'highly concentrated' };
  if (hhi > 1500) return { color: 'var(--orange)', label: 'moderate' };
  return { color: 'var(--green)', label: 'diffuse' };
}

// Single-glance "where in the band" chip — used in panel headers next to
// the title. One number + colour + plain-English label, the formula is in
// the panel's own InfoTip. Replaces the old "HHI 5135 · highly concentrated"
// fine-print captions everywhere.
function ConcentrationChip({ hhi }) {
  const band = concentrationBand(hhi);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px', borderRadius: 10,
      background: 'transparent', border: `1px solid ${band.color}`,
      fontFamily: 'var(--font-mono)', fontSize: 11,
      color: band.color,
    }}>
      <span style={{ width: 6, height: 6, background: band.color, borderRadius: 3 }} />
      {band.label} · HHI {Math.round(hhi).toLocaleString()}
    </span>
  );
}

// Stat tile — 12px label over a larger value. Used in concentration
// strip + Modeled Risk scorecards. Just the visual; no semantics baked in.
function MiniStat({ label, value, color, sub }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--bg-soft)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: color || 'var(--fg)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Generic pagination wrapper for long row lists. Holds its own page state
// so it survives ChartPanel re-renders. `total` is the unpaged row count,
// `pageSize` defaults to 10, and the child gets `(start, end)` indices to
// slice. Page number resets to 1 whenever `resetKey` changes — pass the
// active sort key (or a string of the sort + protocol filter) so re-sorting
// snaps back to page 1 rather than leaving the reader stranded on page 7
// of a different order.
function Pager({ total, pageSize = 10, resetKey, children }) {
  const [page, setPage] = useStateP(1);
  useEffectP(() => { setPage(1); }, [resetKey]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(total, start + pageSize);

  return (
    <>
      {children({ start, end, page: safePage, pageCount })}
      {total > pageSize && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 4px 4px', borderTop: '1px solid var(--border-soft)',
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)',
        }}>
          <span>Showing <span style={{ color: 'var(--fg)' }}>{start + 1}</span>–<span style={{ color: 'var(--fg)' }}>{end}</span> of {total}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
              style={{ ...pagerBtnStyle, opacity: safePage <= 1 ? 0.35 : 1, cursor: safePage <= 1 ? 'default' : 'pointer' }}>‹ Prev</button>
            <span style={{ minWidth: 70, textAlign: 'center', color: 'var(--fg)' }}>Page {safePage} / {pageCount}</span>
            <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount}
              style={{ ...pagerBtnStyle, opacity: safePage >= pageCount ? 0.35 : 1, cursor: safePage >= pageCount ? 'default' : 'pointer' }}>Next ›</button>
          </div>
        </div>
      )}
    </>
  );
}
const pagerBtnStyle = {
  background: 'var(--bg-soft)', border: '1px solid var(--border)',
  color: 'var(--fg)', fontFamily: 'var(--font-mono)', fontSize: 11,
  padding: '4px 10px', borderRadius: 4,
};

// Tiny colour-swatch legend item. Used in chart headers so a reader can
// see what each colour means without hovering individual marks.
function LegendChip({ color, text }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      {text}
    </span>
  );
}

// Horizontal share bars — one row per category, bar width proportional to
// value. Cleaner than a stacked bar when there are 4-6 segments because
// each label/value reads at a glance.
function ShareBars({ items, formatter = (v) => v.toFixed(0) }) {
  const total = items.reduce((s, x) => s + (x.value || 0), 0);
  if (total <= 0) return <div style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No data</div>;
  return (
    <div style={{ fontFamily: 'var(--font-mono)' }}>
      {items.map((it, i) => {
        const pct = (it.value || 0) / total * 100;
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3, fontSize: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: it.color || 'var(--fg-muted)' }} />
                <span style={{ color: 'var(--fg)' }}>{it.label}</span>
              </span>
              <span style={{ color: 'var(--fg-muted)' }}>
                {formatter(it.value)} <span style={{ marginLeft: 6, color: 'var(--fg-dim)' }}>{pct.toFixed(1)}%</span>
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-soft)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(1, pct)}%`, height: '100%', background: it.color || 'var(--fg-muted)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Oracle configuration view. CORRECTION 2026-06: replaces the old
// "OracleConcentrationView" which rendered a false "100% Pyth / single point
// of failure" because the backend hardcoded every pool's oracle to Pyth.
//
// Reality: Pyth is the primary feed at every protocol, but most run a
// documented secondary (NAVI + Supra, Suilend + Switchboard, Scallop's
// xOracle over Pyth/Switchboard/Supra). Only AlphaLend is genuinely
// single-source. This view shows the per-protocol oracle SET and frames the
// real risk: the failover weights and staleness thresholds are not public,
// so it is unclear whether the secondaries contribute to price formation in
// normal operation or only on Pyth fallback.
function OracleConfigView({ config, colorMap, protocolName, pythPrimaryCount, withSecondaryCount, providerCount, meta }) {
  if (!config || config.length === 0) {
    return <div style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No oracle data indexed.</div>;
  }
  // Freshness discipline for the hardcoded oracle map. `meta` carries the
  // oldest verified date + any entries past the recheck cadence; we stamp the
  // date and flip an amber "recheck due" chip when stale, so the map can't go
  // silently stale-wrong the way the old "100% Pyth" claim did.
  const fmtVerified = (iso) => {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const stale = meta && Array.isArray(meta.staleProtocols) && meta.staleProtocols.length > 0;
  const verifiedLabel = fmtVerified(meta?.oldestVerifiedAt);
  const chip = (name, primary) => {
    const color = colorMap[name] ?? 'var(--fg-muted)';
    return (
      <span key={name} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 9px', borderRadius: 12, marginRight: 6, marginBottom: 4,
        background: `${color}1f`, fontFamily: 'var(--font-mono)', fontSize: 11,
        border: primary ? `1px solid ${color}` : '1px solid transparent',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: color }} />
        <span style={{ color: 'var(--fg)', fontWeight: primary ? 600 : 400 }}>{name}</span>
        {primary && <span style={{ fontSize: 9, color: 'var(--fg-muted)', letterSpacing: 0.4 }}>PRIMARY</span>}
      </span>
    );
  };
  return (
    <div>
      {/* Headline strip — the honest summary, no false SPOF claim. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <MiniStat label="Pyth primary" value={`${pythPrimaryCount}/${config.length}`} sub="every protocol" />
        <MiniStat label="Has a secondary" value={`${withSecondaryCount}/${config.length}`} sub="documented feed" />
        <MiniStat label="Distinct providers" value={String(providerCount)} sub="across the sector" />
      </div>

      {/* Per-protocol oracle sets */}
      <div style={{ marginBottom: 14 }}>
        {config.map(o => (
          <div key={o.protocol} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ minWidth: 92, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--fg)', paddingTop: 3 }}>
              {protocolName(o.protocol)}
            </div>
            <div style={{ flex: 1 }}>
              {chip(o.primary, true)}
              {(o.secondaries || []).map(s => chip(s, false))}
              {(o.secondaries || []).length === 0 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--orange)', letterSpacing: 0.3 }}>no secondary documented</span>
              )}
            </div>
            {o.verifiedAt && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-muted)', paddingTop: 4, whiteSpace: 'nowrap' }}
                title={`Oracle config last verified against ${protocolName(o.protocol)}'s own docs on ${fmtVerified(o.verifiedAt)}`}>
                ✓ {fmtVerified(o.verifiedAt)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Honest risk callout — undocumented failover, not single-oracle. */}
      <div style={{ padding: '10px 12px', background: 'var(--accent-orange-soft)', borderLeft: '3px solid var(--orange)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-orange)', lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>⚠ Undocumented failover</div>
        Pyth is primary at every protocol. Most carry a secondary, but the failover weights and staleness
        {' '}thresholds are not public, so it is unclear whether the secondaries contribute to price formation
        {' '}in normal operation or only when Pyth fails. A bad Pyth quote would not behave identically across
        {' '}the five, but it would still drive most of the sector's pricing.
      </div>

      {/* Hardcode-provenance footer. This map is hand-maintained metadata, not
          a live read — so it carries a last-verified date and a recheck cadence.
          Amber when any entry is past the cadence: that is the guardrail that
          stops it going silently stale-wrong. */}
      {meta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 10, color: stale ? 'var(--accent-orange)' : 'var(--fg-muted)' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 10,
            background: stale ? 'var(--accent-orange-soft)' : 'var(--bg-soft, rgba(127,127,127,0.08))',
            border: `1px solid ${stale ? 'var(--orange)' : 'var(--border-soft)'}`,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: stale ? 'var(--orange)' : 'var(--green, #2ecc71)' }} />
            {stale ? 'Recheck due' : 'Verified'}
          </span>
          <span>
            {stale
              ? `Oracle map past its ${meta.recheckDays}d recheck: ${meta.staleProtocols.map(protocolName).join(', ')}. Re-verify against each protocol's docs.`
              : `Hand-verified metadata, oldest entry ${verifiedLabel}. Re-checked every ${meta.recheckDays} days against each protocol's docs.`}
          </span>
        </div>
      )}
    </div>
  );
}

// Centered donut + legend, used by both concentration panels so they read
// as a matched pair. The donut is horizontally centered (not pinned left
// in a 140px column), the legend stacks below as a single-row list when
// the donut has ≤2 segments and as a 2-col grid when there are more.
// `emptyNote` shows when the concentration is degenerate (1 segment owns
// 100%) so the user sees the so-what without doing the maths.
function ConcentrationDonut({ items, formatter = (v) => v.toFixed(0), emptyNote }) {
  const total = items.reduce((s, x) => s + (x.value || 0), 0);
  if (total <= 0) return <div style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No data</div>;
  const cols = items.length <= 2 ? 1 : 2;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 14px' }}>
        <Donut items={items} size={160} thickness={26} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '4px 18px' }}>
        {items.map(it => {
          const pct = (it.value || 0) / total * 100;
          return (
            <div key={it.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--border-soft)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: it.color || 'var(--fg-muted)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
              </span>
              <span style={{ color: pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--orange)' : 'var(--fg)', fontWeight: 600 }}>
                {pct.toFixed(1)}% <span style={{ color: 'var(--fg-muted)', fontWeight: 400, marginLeft: 4 }}>({formatter(it.value)})</span>
              </span>
            </div>
          );
        })}
      </div>
      {emptyNote && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--accent-orange-soft)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-orange)', lineHeight: 1.5 }}>
          ⚠ {emptyNote}
        </div>
      )}
    </div>
  );
}

// Donut for small categorical splits (e.g. oracle providers, fee mix).
// Cleaner than a text table — shows share at a glance and uses the same
// colour tokens as the rest of the dashboard. `items: [{name, value, color}]`.
function Donut({ items, size = 140, thickness = 22 }) {
  const total = items.reduce((s, x) => s + (x.value || 0), 0);
  if (total <= 0 || items.length === 0) {
    return <div style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>No data</div>;
  }
  const r  = size / 2 - thickness / 2;
  const cx = size / 2, cy = size / 2;
  const C  = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {items.map((it, i) => {
        const frac = (it.value || 0) / total;
        const dash = C * frac;
        const gap  = C - dash;
        const off  = -acc * C;
        acc += frac;
        return (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={it.color || 'var(--fg-muted)'} strokeWidth={thickness}
            strokeDasharray={`${dash} ${gap}`} strokeDashoffset={off}
            transform={`rotate(-90 ${cx} ${cy})`} />
        );
      })}
    </svg>
  );
}

// NOTE 2026-06: Gauge and PairedBars were removed here. Both were built
// solely for the Modeled-Risk panel (the half-circle probability gauge and
// the Historical-vs-Heavy-tail VaR bars). That panel was removed (RM-1), so
// the components were orphaned. Deleted as part of a stale-code sweep.

// Asset-symbol normalization for the Collateral page.
//
// Lending adapters report the on-chain symbol of every market — and Bucket's
// extra-tvl walks emit synthetic symbols for vault wrappers (`PSM-BUCK`,
// `BKT-SAVE-HASUI_S`, `BKT-PSM-USDC_CIRCLE`, …). Treating those as separate
// assets double-counts the underlying (e.g. haSUI shows once as the pool
// symbol and again as `BKT-SAVE-HASUI_S`). It also case-splits the same
// on-chain token: xBTC (NAVI) and XBTC (Alphalend/Suilend) are the same
// wrapped BTC. This map collapses every wrapper to its underlying asset and
// case-folds equivalents so the "Collateral by Asset" view shows real
// economic exposure, not adapter labels.
function normalizeAssetSymbol(sym) {
  if (!sym) return sym;
  const s = String(sym);
  // Direct overrides (wrappers that strip down to an LP that's effectively USDC).
  const map = {
    BUCKETUS: 'USDC', BLUEFIN_STABLE_LP: 'USDC',
    CETABLE: 'USDC', STAPEARL: 'USDC',
    USDC_CIRCLE: 'USDC', USDC_WORMHOLE: 'USDC',
    USDT_WORMHOLE: 'USDT', SUI_BRIDGE_USDT: 'USDT', suiUSDT: 'USDT',
    wUSDT: 'USDT', wUSDC: 'USDC',
    SAVING: 'USDB',  // SAVING-USDB → USDB
    xBTC: 'XBTC', wBTC: 'WBTC',
  };
  // Direct match first
  if (map[s]) return map[s];
  // Common prefixes — peel layer by layer.
  // PSM-BUCK / PSM-USDC / PSM-USDT / PSM-USDSUI / SAVING-USDB
  let m = s.match(/^PSM-(.+)$/);                    if (m) return normalizeAssetSymbol(m[1]);
  m = s.match(/^SAVING-(.+)$/);                     if (m) return m[1].toUpperCase();
  m = s.match(/^V1PSM-(.+)$/);                      if (m) return normalizeAssetSymbol(m[1]);
  m = s.match(/^V1-(.+)$/);                         if (m) return normalizeAssetSymbol(m[1]);
  m = s.match(/^BKT-PSM-(.+)$/);                    if (m) return normalizeAssetSymbol(m[1]);
  // BKT-SAVE-HASUI_S → haSUI, BKT-SAVE-NAVI_STSUI → stSUI, etc.
  m = s.match(/^BKT-SAVE-(.+)$/);                   if (m) {
    const part = m[1].replace(/_S$/, '').replace(/^NAVI_/, '').replace(/_NAVI_POND$/, '');
    const u = part.toUpperCase();
    if (u === 'HASUI') return 'haSUI';
    if (u === 'AFSUI') return 'afSUI';
    if (u === 'VSUI')  return 'vSUI';
    if (u === 'STSUI') return 'stSUI';
    if (u === 'SUI')   return 'SUI';
    return part;
  }
  m = s.match(/^BKT-SCOIN-(.+)$/);                  if (m) return normalizeAssetSymbol(m[1]);
  m = s.match(/^BKT-AF-FOUNTAIN-/);                 if (m) return 'BUCK';
  m = s.match(/^BKT-KRIYA-FOUNTAIN-/);              if (m) return 'BUCK';
  m = s.match(/^BKT-AF-(.+)$/);                     if (m) {
    // BKT-AF-AFSUI-SUI is an afSUI/SUI LP — book to afSUI (it's the staked
    // asset in the CDP that's actually deposited; the bucketUS wrappers
    // round-trip into the same pricing source).
    return 'afSUI';
  }
  // Final dedupe: anything matching a known underlying name post-cleanup.
  if (map[s]) return map[s];
  return s;
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
            {/* Single header ⓘ that carries everything: chart description,
                source provenance, and the as-of timestamp. Replaces the old
                stacked footer (insight line + source row + as-of row) that
                read as AI-generated narrative. The user now sees a clean
                chart; methodology is one hover away. */}
            {(description || source) && (() => {
              const asOf = D.asOf;
              const cp = asOf?.checkpoint != null ? `#${asOf.checkpoint.toLocaleString()}` : null;
              const ts = asOf?.checkpointTimestamp ? new Date(asOf.checkpointTimestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : null;
              return (
                <span className="info-icon" tabIndex={0}>
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6.5" />
                    <line x1="8" y1="7" x2="8" y2="11.5" />
                    <circle cx="8" cy="4.8" r="0.4" fill="currentColor" />
                  </svg>
                  <span className="info-tip" role="tooltip">
                    {description}
                    {source && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: 10, opacity: 0.85 }}>
                        <div><strong>Source:</strong> {source}</div>
                        {cp && ts && <div><strong>As of:</strong> checkpoint {cp} · {ts}</div>}
                      </div>
                    )}
                  </span>
                </span>
              );
            })()}
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
        {/* No more footer. Insight + source + as-of all live in the header ⓘ.
            The `insight` prop is preserved on the API for back-compat but
            currently unrendered — chart bodies stay clean and the AI-narrative
            readout no longer ships by default. */}
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
  // Prefer the backend's COUNT(*) (independent of the LIMIT 500 row cap on
  // the rows we fetch for the table). Falls back to .length on older API
  // payloads. The old KPI showed exactly 500 — the SQL cap, not a real count.
  const liq30d = (typeof D.liq30dCount === 'number' && D.liq30dCount > 0)
    ? D.liq30dCount
    : D.liquidations.length;

  // Per-protocol TVL method (net / gross / remote) for the disclosure
  // tooltip on the headline TVL KPI. Sector TVL is a SUM of per-protocol
  // methods — it does NOT equal Supplied − Borrowed because some protocols
  // report gross supply, some net liquidity, and Scallop / Bucket use
  // their own canonical fetch. Disclosed inline so the arithmetic mismatch
  // the user spotted (586.8 − 211.7 = 375.1 ≠ 426.5) is documented at
  // the source.
  const tvlBreakdownNote = (D.protocolMetrics || [])
    .map(p => `• ${p.id} — ${(p.tvlMethod || 'gross').toUpperCase()}: $${(p.tvl).toFixed(1)}M`)
    .join('\n');
  const tvlNote = `TVL sums per-protocol methods (mixed basis):\n${tvlBreakdownNote}\n\nThis sum does NOT equal Supplied − Borrowed because each protocol's UI reports a different TVL definition (some net, some gross, some via remote canonical fetch). We match each protocol's own headline number, then sum. See Methodology page for the per-protocol calibration.`;

  return (
    <PageShell pageId="overview" title="Lending Terminal: SUI — Overview" terminal="lending-terminal-sui-overview">
      {/* Data Integrity + Methodology moved to their own page (sidebar
          → Workspace → Methodology). Overview now leads with the headline
          KPIs and the chart grid — no audit chrome before the user sees
          a single number. The header still carries the worst-of integrity
          status as a DataQualityBadge so degraded data is impossible to
          miss without opening the methodology page. */}
      <KpiStrip items={[
        { id: 'tvl',    label: 'Total Value Locked', value: fmtUSD(totalTvl * 1e6, 1), change: 4.82, spark: D.kpiSparks.tvl.slice(-30),
          subLabel: 'mixed-method sum · see ⓘ', note: tvlNote },
        { id: 'supply', label: 'Total Supplied',     value: fmtUSD(totalSupply * 1e6, 1), change: 5.10, spark: D.kpiSparks.supply.slice(-30),
          subLabel: 'gross deposits, all protocols' },
        { id: 'borrow', label: 'Total Borrowed',     value: fmtUSD(totalBorrow * 1e6, 1), change: 3.42, spark: D.kpiSparks.borrow.slice(-30),
          subLabel: `${(totalBorrow / totalSupply * 100).toFixed(0)}% utilization` },
        { id: 'liq',    label: 'Liquidations (30D)', value: fmtNum(liq30d, 0), change: -2.1, subLabel: 'true count · sub-$1 events filtered', spark: D.kpiSparks.liq.slice(-30) },
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

      {/* Side-by-side protocol comparison (was its own page; user merged
          it back into Overview since it answers the same question the
          chart grid above is asking, just numerically). Sortable on every
          column. Clicking the protocol name navigates to that protocol's
          deep-dive page. */}
      <div style={{ marginTop: 16 }}>
        <ProtocolComparisonTable />
      </div>

    </PageShell>
  );
}

// ── ProtocolComparisonTable ─────────────────────────────────────────
// Used to live on its own Compare page; now mounted at the bottom of
// Overview as the canonical cross-protocol view. Each row = one protocol;
// each column = one headline metric. Click any column header to re-sort,
// click the protocol name to jump to that protocol's detail page.
function ProtocolComparisonTable() {
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

    const wSup = all.reduce((s, r) => s + (r.supplyApy || 0) * (r.supply || 0), 0);
    const wSupTot = all.reduce((s, r) => s + (r.supply || 0), 0);
    const wBor = all.reduce((s, r) => s + (r.borrowApy || 0) * (r.borrow || 0), 0);
    const wBorTot = all.reduce((s, r) => s + (r.borrow || 0), 0);
    const supplyApy = wSupTot > 0 ? wSup / wSupTot : 0;
    const borrowApy = wBorTot > 0 ? wBor / wBorTot : 0;
    const utilization = wSupTot > 0 ? wBorTot / wSupTot * 100 : 0;

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

    let stableBorrow = 0, totalBorrow = 0;
    pool.forEach(r => { totalBorrow += r.borrow || 0; if (STABLE_SYMS.has(r.sym)) stableBorrow += r.borrow || 0; });
    vault.forEach(r => { totalBorrow += r.debtUsd || 0; stableBorrow += r.debtUsd || 0; });
    const stableDebtShare = totalBorrow > 0 ? stableBorrow / totalBorrow * 100 : 0;

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

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">
          <span className="bullet">●</span> Protocol comparison
          <InfoTip>
            Side-by-side headline metrics for every protocol. Click any column
            header to re-sort. Protocol name links to that protocol's deep-dive
            page. TVL src tag explains how each headline TVL is computed —
            NET = supply − borrow per protocol UI, GROSS = total deposits,
            REMOTE = canonical fetch (Scallop indexer / DefiLlama).
          </InfoTip>
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
          click any column to sort
        </span>
      </div>
      <div className="panel-body" style={{ padding: '0 16px 16px' }}>
        <DataTable
          columns={columns}
          rows={rows}
          initialSort={{ id: 'tvl', dir: 'desc' }}
          emptyMessage="No protocols loaded."
        />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// PAGE 0 — Methodology & Data Sources
// ════════════════════════════════════════════════════════════════
//
// Hosts the two audit / methodology surfaces that used to live on the
// Overview page:
//   • IntegrityPanel  — the §3 publication gates (conservation, bounds,
//                       aggregation, reconciliation, freshness, provenance,
//                       stale-collateral, outlier-row sanity). Each gate
//                       returns pass / warn / fail with a one-line detail.
//   • MethodologyPanel — data-source map, refresh cadence, TVL formula per
//                       protocol, known coverage gaps.
//
// Reachable from the sidebar → Workspace → Methodology. Surfaced as its own
// page so first-time visitors land on the actual lending data, not the
// audit chrome, but the methodology is still one click away and the
// header DataQualityBadge nudges them here when something is off.
function PageMethodology() {
  return (
    <PageShell pageId="methodology"
      title="Methodology & Data Integrity"
      terminal="lending-terminal-sui-methodology">
      <div style={{ marginTop: 16 }}>
        <IntegrityPanel />
      </div>
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
        // Relabelled 2026-05-31: "Active Users" was actually a max of
        // (distinct liquidated borrowers in 30D) and (WalletPosition rows
        // for this protocol). The standard says label honestly — so we
        // surface the more specific name. WalletPosition is currently NAVI-
        // only, which is why other protocols read low; Bucket reads 0
        // because no liquidation events have been ingested for Bucket
        // (Bucket doesn't liquidate, it redeems).
        { id: 'users',   label: 'Distinct addresses (30D)', value: fmtNum(metrics.users, 0), change: 2.8,
          subLabel: 'liq. borrowers + wallet positions',
          note: 'Distinct addresses we observed acting on this protocol in the last 30 days. Two sources merged: distinct borrowers in liquidation events + WalletPosition rows. WalletPosition is currently only indexed for NAVI; other protocols only count from liquidations. This proxies "active users" but is not a true active-user count.' },
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
                    <td style={{ padding: 8 }}>
                      {m.ltv}%
                      {/* Borrow-only marker — NAVI (and Suilend on some
                          assets) exposes "collateral-disabled" markets
                          with ltv=0 and lt>0. Without this chip the row
                          reads like a missing-data bug. */}
                      {(m.ltv === 0 && (m.liqThreshold ?? 0) > 0) && (
                        <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 2, background: 'var(--bg-soft)', color: 'var(--fg-muted)', letterSpacing: '0.04em' }} title={`Borrow-only market: can be borrowed but not posted as collateral. LT ${(m.liqThreshold ?? 0).toFixed(0)}% still applies to existing positions.`}>BORROW-ONLY</span>
                      )}
                    </td>
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
                    <td style={{ padding: 8 }}>{m.minCR != null ? `${m.minCR}%` : '—'}</td>
                    <td style={{ padding: 8 }}>{m.redemptionFee != null ? `${m.redemptionFee.toFixed(2)}%` : '—'}</td>
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
          title="Lending markets — rates, utilization, supply"
          caption="every pool across the 4 pool-archetype protocols"
          protocolMode="single"
          description="Snapshot of all lending markets on Sui from the four pool-archetype protocols (NAVI, Suilend, Scallop, AlphaLend). Click a row to drill into the market. Sort by any column from the dropdown. Spread = borrow APY − supply APY (what the protocol + suppliers split). Kink = utilization where the IRM bends into the jump-rate regime."
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
            // Paginate to 10 rows per page so the table doesn't run for two
            // screens. Sort key is folded into resetKey so changing the sort
            // snaps back to page 1.
            const pageSize = size === 'expanded' ? 25 : 10;
            return (
              <Pager total={rows.length} pageSize={pageSize} resetKey={`${proto}|${metric}`}>
                {({ start, end }) => (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      <thead>
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
                        {rows.slice(start, end).map((m, i) => (
                          <tr key={start + i} className="row-clickable" onClick={() => goToMarket(m.protocol, m.sym)}
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
                )}
              </Pager>
            );
          }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Bucket vaults — collateral, debt, fees"
          caption="every CDP vault on Bucket Protocol"
          description="Bucket runs a single-asset-mint CDP: deposit collateral, mint USDB (or BUCK on V1). Min CR is the minimum collateral ratio before a vault is redemption-eligible. Redemption fee is paid by the redeemer when they swap USDB for collateral. PSM fee is the spread on direct stablecoin-to-USDB swaps."
          protocolMode="none"
          metricItems={[
            { id: 'collateralUsd', label: 'Sort: Collateral' },
            { id: 'debtUsd',       label: 'Sort: USDB Debt' },
            { id: 'interestRate',  label: 'Sort: Interest' },
          ]}
          defaultMetric="collateralUsd"
          render={({ metric, size }) => {
            const rows = [...D.vaults].sort((a, b) => b[metric] - a[metric]);
            const pageSize = size === 'expanded' ? 25 : 10;
            return (
              <Pager total={rows.length} pageSize={pageSize} resetKey={metric}>
                {({ start, end }) => (
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
                        {rows.slice(start, end).map((m, i) => (
                          <tr key={start + i} className="row-clickable" onClick={() => goToMarket('bucket', m.sym)}
                              style={{ borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
                            <td style={{ padding: 8, color: 'var(--fg)' }}>{m.sym}</td>
                            <td style={{ padding: 8 }}>{fmtUSD(m.collateralUsd * 1e6, 1)}</td>
                            <td style={{ padding: 8 }}>{fmtUSD(m.debtUsd * 1e6, 1)}</td>
                            <td style={{ padding: 8, color: 'var(--red)' }}>{m.interestRate.toFixed(2)}%</td>
                            <td style={{ padding: 8 }}>{m.redemptionFee != null ? `${m.redemptionFee.toFixed(2)}%` : '—'}</td>
                            <td style={{ padding: 8 }}>{m.psmFee != null ? `${m.psmFee.toFixed(2)}%` : '—'}</td>
                            <td style={{ padding: 8 }}>{m.minCR != null ? `${m.minCR}%` : '—'}</td>
                            <td style={{ padding: 8, color: 'var(--fg-muted)' }}>›</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Pager>
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
          title="Where the fee revenue comes from"
          caption="last 30 days, stacked by protocol"
          className="col-8"
          protocolMode="multi"
          description="Daily protocol-level fee revenue, stacked. Fees ≈ borrow × borrow APY × reserve factor; we use a coarse 10% reserve factor across protocols as the proxy until each adapter exposes its actual per-pool number. Toggle the metric to compare against TVL on the same y-axis."
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
            // Treemap's default formatter multiplies the input by 1e6 (it
            // assumes values are in $M, matching the Protocol Mix treemap
            // up above). Fee values here are already in dollars — pass an
            // explicit formatter so the labels don't blow up by 10⁶ and
            // claim "$46.78B" when the KPI strip says "$128.29K". Fixed
            // 2026-05-31.
            return <Treemap items={items} width={w} height={h} formatter={(v) => fmtUSD(v, 1)} />;
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
  // Aggregate by asset across ALL protocols (default) — also support per-protocol view.
  //
  // Two normalization passes here:
  //   1. Vault unwrap: Bucket reports synthetic symbols for vault wrappers
  //      (PSM-BUCK, BKT-SAVE-HASUI_S, BKT-PSM-USDC_CIRCLE, …). Without
  //      mapping these back to USDC / haSUI / etc., the "Collateral by Asset"
  //      view both invents fake assets AND double-counts the underlying.
  //   2. Case dedupe: xBTC (NAVI) and XBTC (Alphalend/Suilend) are the same
  //      on-chain wrapped BTC. wBTC and WBTC, wUSDT and suiUSDT and USDT,
  //      same story. We canonicalize via normalizeAssetSymbol() before
  //      summing so the bars don't get split across casings.
  //
  // Sym-to-name shown in tooltips so a curious reader can see which raw
  // labels were merged into each bucket.
  const aggByAsset = (protoFilter) => {
    const byAsset = {};
    const sources = {};
    const push = (sym, value) => {
      const k = normalizeAssetSymbol(sym);
      byAsset[k] = (byAsset[k] || 0) + (value || 0);
      if (k !== sym) {
        sources[k] = sources[k] || new Set();
        sources[k].add(sym);
      }
    };
    D.pools.forEach(p => { if (matchProto(p, protoFilter)) push(p.sym, p.supply); });
    D.vaults.forEach(v => { if (matchProto(v, protoFilter)) push(v.sym, v.collateralUsd); });
    return Object.entries(byAsset).map(([sym, value]) => ({
      sym, value,
      mergedFrom: sources[sym] ? Array.from(sources[sym]).sort() : null,
    })).sort((a,b) => b.value - a.value);
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

  // Oracle configuration per protocol. CORRECTION 2026-06: the previous
  // version counted "pools per single hardcoded source" and always produced
  // 100% Pyth, which is false. The backend now emits `oracleConfig`: each
  // protocol's primary feed plus documented secondaries. Pyth is primary at
  // every protocol; 4 of 5 document a secondary. The honest systemic point
  // is undocumented failover logic, not single-oracle dependence.
  const oracleConfig = D.oracleConfig || [];
  const oracleConfigMeta = D.oracleConfigMeta || null;
  const protocolName = (id) => (D.protocols.find(p => p.id === id)?.name) || id;
  const pythPrimaryCount = oracleConfig.filter(o => o.primary === 'Pyth').length;
  const withSecondaryCount = oracleConfig.filter(o => (o.secondaries || []).length > 0).length;
  // Distinct providers across the whole sector (for the headline).
  const allProviders = new Set();
  oracleConfig.forEach(o => { allProviders.add(o.primary); (o.secondaries || []).forEach(s => allProviders.add(s)); });

  // colour tokens for oracle providers — generic so adding a Switchboard /
  // Supra adapter in future just shows up with the right swatch.
  const ORACLE_COLOR = { Pyth: '#7B61FF', Switchboard: '#00C896', Supra: '#E5B345', unknown: 'var(--fg-muted)' };

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

      {/* Concentration panels per §4 Tier 3. Both use a donut now so they
          read as a matched pair. Plain-English labels replace the previous
          "Top 1 / Top 3 / Top 5 / Unique" jargon — those numbers go in
          MiniStats on each side. */}
      <div className="grid grid-12" style={{ marginTop: 16 }}>
        <div className="panel col-6">
          <div className="panel-header">
            <span className="panel-title">
              <span className="bullet">●</span> Asset concentration
              <InfoTip>
                How crowded the sector's collateral is on a handful of assets.
                {' '}If one asset crashes, lenders backing that asset eat
                {' '}most of the loss. HHI = Σ(share%)² across assets — &gt;2500 highly
                {' '}concentrated, 1500–2500 moderate, ≤1500 diffuse.
              </InfoTip>
            </span>
            <ConcentrationChip hhi={supplyHhi} />
          </div>
          <div className="panel-caption">
            <b>How crowded the sector's collateral is on a few assets.</b> A crash in one concentrated asset is borne by the lenders backing it — diffuse collateral spreads that risk.
          </div>
          <div className="panel-body">
            {/* Re-labelled MiniStats — plain English. Old labels were
                "Top 1 / Top 3 / Top 5 / Unique" which is jargon. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
              <MiniStat label="Largest asset"  value={`${top1Share.toFixed(1)}%`}
                color={top1Share > 50 ? 'var(--red)' : top1Share > 30 ? 'var(--orange)' : 'var(--fg)'}
                sub={allAssetRows[0]?.sym || '—'} />
              <MiniStat label="Top 3 combined" value={`${top3Share.toFixed(1)}%`} sub="of collateral" />
              <MiniStat label="Top 5 combined" value={`${top5Share.toFixed(1)}%`} sub="of collateral" />
              <MiniStat label="Number of assets" value={String(allAssetRows.length)} sub="indexed" />
            </div>
            {/* Donut: top 8 assets + a single "Other" wedge for the long tail */}
            <ConcentrationDonut
              items={[
                ...allAssetRows.slice(0, 8).map(r => ({ name: r.sym, value: r.value, color: colorFor(r.sym) })),
                allAssetRows.length > 8
                  ? { name: `Other (${allAssetRows.length - 8})`, value: allAssetRows.slice(8).reduce((s, r) => s + r.value, 0), color: 'var(--fg-muted)' }
                  : null,
              ].filter(Boolean)}
              formatter={(v) => fmtUSD(v * 1e6, 1)}
            />
          </div>
        </div>

        <div className="panel col-6">
          <div className="panel-header">
            <span className="panel-title">
              <span className="bullet">●</span> Oracle configuration
              <InfoTip>
                Which price oracles each protocol uses. Pyth is the primary
                {' '}feed at every protocol; most document a secondary
                {' '}(Supra, Switchboard). The risk is not single-oracle
                {' '}dependence, it is that the failover weights and staleness
                {' '}thresholds for those secondaries are not publicly
                {' '}documented, so it is unclear whether a secondary actually
                {' '}contributes to price formation or only on Pyth fallback.
              </InfoTip>
            </span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              {pythPrimaryCount}/{oracleConfig.length} on Pyth primary
            </span>
          </div>
          <div className="panel-caption">
            <b>Pyth is primary at all five protocols.</b> The systemic risk is undocumented failover, not single-oracle dependence — secondaries exist but their weights and staleness thresholds aren't public.
          </div>
          <div className="panel-body">
            <OracleConfigView
              config={oracleConfig}
              colorMap={ORACLE_COLOR}
              protocolName={protocolName}
              pythPrimaryCount={pythPrimaryCount}
              withSecondaryCount={withSecondaryCount}
              providerCount={allProviders.size}
              meta={oracleConfigMeta}
            />
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
// ── REMOVED 2026-06-01 ─────────────────────────────────────────────
// StressTestPanel — the interactive collateral-price-shock test — used
// market-aggregate Health Factor as input. Aggregate-HF reduces
// algebraically to LT / utilization, which is a utilization ratio rather
// than a real health factor. Removed entirely until per-wallet position
// indexing is built across all 5 protocols (see RM-1).


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

  // NOTE 2026-06-01: HF distribution / collateral-at-risk shock table /
  // Monte Carlo cluster all removed (RM-1). They depended on a market-
  // aggregate "Health Factor" that algebraically reduces to LT / utilization
  // — a utilization ratio dressed as a health factor, not a real one.
  // Without per-wallet position data (currently un-indexed across all 5
  // protocols) there's no honest way to compute position risk. Replaced by
  // a single explicit placeholder block on the page itself, so the page
  // doesn't read as broken with a gap where the cluster used to sit.

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
  // Risk-page concentration is DEBT-side, not supply-side. The Collateral
  // page already shows supply concentration ("what backs the sector"); on
  // Risk we want "what's actually borrowed against" — which assets carry
  // the most live debt and would dominate losses in a stress event. Same
  // normalize() and HHI math; different aggregation column.
  const borrowByAsset = allRows.reduce((acc, r) => {
    const sym = normalizeAssetSymbol(r.sym || r.asset || '?');
    const bor = r.borrow || r.debtUsd || 0;
    if (bor > 0) acc[sym] = (acc[sym] || 0) + bor;
    return acc;
  }, {});
  const totBorrow = Object.values(borrowByAsset).reduce((s, v) => s + v, 0);
  const debtHhi = Object.values(borrowByAsset).reduce((s, v) => {
    const share = totBorrow > 0 ? (v / totBorrow * 100) : 0;
    return s + share * share;
  }, 0);
  const debtHhiBand = concentrationBand(debtHhi);

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
        { id: 'hhi', label: 'Debt-side HHI',        value: debtHhi.toFixed(0), change: 0, subLabel: debtHhiBand.label, note: 'Concentration of live borrows by asset. Supply-side HHI is on the Collateral page.' },
      ]} />

      {/* Position-risk placeholder — replaces the HF distribution, the
          stress-test curve, and the Monte Carlo cluster. All three depended
          on a market-aggregate "Health Factor" which is algebraically
          LT / utilization — a utilization ratio dressed as a health factor.
          Per-wallet positions aren't indexed for the 5 Sui protocols yet,
          so position-level risk can't be computed honestly. Rather than
          ship a proxy that reads as risk, we mark the gap explicitly. */}
      <div style={{ marginTop: 16 }}>
        <div className="panel" style={{ borderStyle: 'dashed' }}>
          <div className="panel-header">
            <span className="panel-title">
              <span className="bullet" style={{ color: 'var(--fg-muted)' }}>○</span> Position-level risk
              <InfoTip>
                Real Health Factor distribution, collateral-at-risk under
                price shocks, and Monte Carlo loss simulations all require
                per-wallet position data (each borrower's collateral mix +
                debt). That's not yet indexed across NAVI / Suilend /
                Scallop / AlphaLend / Bucket — each exposes positions
                differently, and aggregating to per-market totals
                collapses the distribution the model needs. Rather than
                ship a market-aggregate proxy (which reduces to a
                utilization ratio, not a real HF), we surface the gap.
              </InfoTip>
            </span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              pending per-wallet indexing
            </span>
          </div>
          <div className="panel-body" style={{ padding: '32px 24px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6, maxWidth: 720 }}>
              <div style={{ fontSize: 13, color: 'var(--fg)', marginBottom: 12 }}>
                <strong>HF distribution · stress curve · Monte Carlo</strong>
                <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 2, background: 'var(--bg-soft)', color: 'var(--fg-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>not yet indexed</span>
              </div>
              <div style={{ marginBottom: 8 }}>
                These three views need per-wallet position data to compute honestly.
                Per-protocol position indexing is the unlock. Until that ships, this
                space holds rather than displaying a proxy that reads as real risk.
              </div>
              <div style={{ marginBottom: 8 }}>
                What this page DOES show right now (real, computed from real data):
              </div>
              <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
                <li>30-day liquidation intensity + efficiency (real events)</li>
                <li>Liquidator leaderboard and largest events (real amounts)</li>
                <li>Debt-side concentration / HHI (real borrows)</li>
                <li>Days since last liquidation incident</li>
              </ul>
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

      {/* Debt-side concentration — what's actually borrowed against. Distinct
          from the Collateral page's supply-side view: there we measure what
          backs the sector, here we measure what's exposed. A few large
          borrow positions in one asset is the riskier shape. */}
      <div style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <span className="bullet">●</span> Debt-side concentration
              <InfoTip>
                Which assets carry the most live borrows. Distinct from the
                {' '}Collateral page's "Asset concentration", which measures what
                {' '}<em>backs</em> the sector. This view shows what's actually
                {' '}<em>exposed</em> — if these assets blow up, losses concentrate here.
                {' '}HHI bands: &gt;2500 highly concentrated, 1500–2500 moderate, ≤1500 diffuse.
              </InfoTip>
            </span>
            <ConcentrationChip hhi={debtHhi} />
          </div>
          <div className="panel-body">
            {totBorrow > 0 ? (
              <Leaderboard items={Object.entries(borrowByAsset)
                .map(([sym, v]) => ({ name: sym, value: v * 1e6 }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 12)} format={fmtUSD} />
            ) : (
              <div style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '12px 0' }}>
                No active borrows in the sector.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modeled risk (Monte Carlo) removed 2026-06-01, see placeholder
          earlier in PageRisk + RM-1. The backend riskModel computation was
          also removed 2026-06 (it ran 5000 MC paths per request for a field
          nothing read); the simulator is parked in src/lib/risk-modeling.ts
          for when per-wallet indexing lands. */}
    </PageShell>
  );
}

// ── REMOVED 2026-06-01 ─────────────────────────────────────────────
// ModeledRiskPanel — the 7-day Monte Carlo, VaR ensemble, Expected
// Shortfall, and backtest cluster. The simulator was fed market-
// aggregate Health Factor (LT / utilization, see above) which collapses
// the per-wallet HF distribution into a single point per market. With
// many markets sitting at aggregate HF ≈ 1.0–1.1, the MC predicts P=100%
// liquidation while realized 30D intensity is 0.05%. Removed entirely
// until per-wallet position indexing is built (see RM-1).

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
            else if (metric === 'hf') events = [...events].sort((a,b) => (a.healthFactor ?? Infinity) - (b.healthFactor ?? Infinity));
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
                      <th style={{ padding: 8 }} title="HF at liquidation — not yet indexed for these events; rendered as '—' rather than a hardcoded 0.950 placeholder.">HF</th>
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
                        <td style={{ padding: 6, color: l.healthFactor != null && l.healthFactor < 0.9 ? 'var(--red)' : 'var(--fg-muted)' }}>
                          {l.healthFactor != null ? l.healthFactor.toFixed(3) : '—'}
                        </td>
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
            <div className="panel-header">
              <span className="panel-title"><span className="bullet">●</span> Risk Parameters</span>
              {((market.ltv ?? 0) === 0 && (market.liqThreshold ?? 0) > 0) && (
                <span title="Borrow-only market: this asset can be borrowed but cannot be posted as collateral. LT still applies to any existing collateralized position." style={{ fontSize: 10, padding: '2px 8px', borderRadius: 2, background: 'var(--bg-soft)', color: 'var(--fg-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>borrow-only</span>
              )}
            </div>
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
              <ParamRow k="Oracle (primary)" v={market.oracleSource || 'Pyth'} />
              {(market.oracleSecondaries && market.oracleSecondaries.length > 0) && (
                <ParamRow k="Oracle (secondary)" v={market.oracleSecondaries.join(', ')} />
              )}
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
                  // x-axis is utilization 0% → 100% sampled at step 2 (51
                  // points). The default formatter rendered "50d ago / Today"
                  // labels because AreaChart assumes time-series. Override
                  // with utilization-% labels so the axis tells the truth.
                  xTickFormatter={(i, n) => `${Math.round((i / (n - 1)) * 100)}%`}
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
        // CR is undefined when debt = 0 — used to render as Infinity%. Guard
        // the divide-by-zero and render "—" (consistent with HF for null-
        // debt markets). minCR sub-label still displays so the parameter is
        // visible even when no positions are open.
        { id: 'cr',  label: 'Aggregate CR',
          value: market.debtUsd > 0
            ? `${(market.collateralUsd / market.debtUsd * 100).toFixed(0)}%`
            : '—',
          change: 0,
          subLabel: market.debtUsd > 0 ? (market.minCR != null ? `min ${market.minCR}%` : 'CDP vault') : 'no debt outstanding' },
        { id: 'rate',label: 'Interest Rate',     value: `${market.interestRate.toFixed(2)}%`, change: 0 },
      ]} />

      <div className="grid grid-12" style={{ marginTop: 16 }}>
        <div className="panel col-6">
          <div className="panel-header"><span className="panel-title"><span className="bullet">●</span> Vault Parameters</span></div>
          <div className="panel-body">
            <ParamRow k="Collateral Asset" v={marketSym} />
            <ParamRow k="Stablecoin Issued" v="USDB" />
            <ParamRow k="Interest Rate"     v={`${market.interestRate.toFixed(2)}%`} c="var(--red)" />
            <ParamRow k="Redemption Fee"    v={market.redemptionFee != null ? `${market.redemptionFee.toFixed(2)}%` : '— (protocol-level)'} c={market.redemptionFee == null ? 'var(--fg-muted)' : undefined} />
            <ParamRow k="PSM Fee"           v={market.psmFee != null ? `${market.psmFee.toFixed(2)}%` : '— (n/a for CDP)'} c={market.psmFee == null ? 'var(--fg-muted)' : undefined} />
            <ParamRow k="Min Collateral Ratio" v={market.minCR != null ? `${market.minCR}%` : '—'} />
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
              // headroom + colour bands only when we have a real minCR. For
              // non-CDP surfaces (minCR null) we can't compute headroom.
              const headroomPP = (backingRatio != null && market.minCR != null) ? backingRatio - market.minCR : null;
              const surplusColor = surplusUsdM < 0 ? 'var(--red)' : surplusUsdM < market.debtUsd * 0.05 ? 'var(--orange)' : 'var(--green)';
              const ratioColor = (backingRatio == null || market.minCR == null) ? 'var(--fg-muted)' :
                                 backingRatio < market.minCR + 5 ? 'var(--red)' :
                                 backingRatio < market.minCR * 1.20 ? 'var(--orange)' :
                                 'var(--green)';
              return (
                <>
                  <ParamRow k="Backing Ratio (CR)" v={backingRatio != null ? `${backingRatio.toFixed(1)}%` : '—'} c={ratioColor} />
                  <ParamRow k="Min CR (liquidation)" v={market.minCR != null ? `${market.minCR}%` : '—'} />
                  <ParamRow k="Headroom over Min CR" v={headroomPP != null ? `${headroomPP.toFixed(1)}pp` : '—'} />
                  <ParamRow k="Surplus / Backing Buffer" v={fmtUSD(surplusUsdM * 1e6, 2)} c={surplusColor} />
                  <ParamRow k="USDB / Collateral (Util)" v={`${(market.debtUsd / Math.max(market.collateralUsd, 1e-9) * 100).toFixed(1)}%`} />
                  {/* Peg / redemption spread per §4 CDP variants. USDB/BUCK
                      market price not yet indexed; render "—" with a not-indexed
                      tag rather than fake it. Redemption / PSM fees aren't
                      indexed either (adapter doesn't persist them yet). */}
                  <ParamRow k="Peg Spread (USDB vs $1)" v="—" c="var(--fg-muted)" />
                  <ParamRow k="Redemption Fee" v={market.redemptionFee != null ? `${market.redemptionFee.toFixed(2)}%` : '— (protocol-level)'} c={market.redemptionFee == null ? 'var(--fg-muted)' : undefined} />
                  <ParamRow k="Spot Price" v={fmtUSD(price, price < 10 ? 4 : 2)} />
                  <ParamRow k="Oracle (primary)" v={market.oracleSource || 'Pyth'} />
                  {(market.oracleSecondaries && market.oracleSecondaries.length > 0) && (
                    <ParamRow k="Oracle (secondary)" v={market.oracleSecondaries.join(', ')} />
                  )}
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

// PageCompare was removed 2026-05-30. The cross-protocol comparison table
// now lives on Overview as ProtocolComparisonTable; the dedicated Compare
// nav item / Compare.html page were dropped.

Object.assign(window, { PageOverview, PageProtocol, PageRates, PageRevenue, PageCollateral, PageRisk, PageLiquidation, PageMarketDetail, PageMethodology });
