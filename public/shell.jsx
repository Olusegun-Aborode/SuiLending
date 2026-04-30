// Shell: topbar, sidebar, status bar, ticker, command palette
// Adapted from Datum Labs SDK shell — Sui Lending nav (6 pages)

const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

const PAGES = [
  { id: 'overview',    label: 'Overview',    href: 'Overview.html',    icon: '◆' },
  { id: 'protocol',    label: 'Protocol',    href: 'Protocol.html',    icon: '▦' },
  { id: 'rates',       label: 'Rates',       href: 'Rates.html',       icon: '%' },
  { id: 'revenue',     label: 'Revenue',     href: 'Revenue.html',     icon: '$' },
  { id: 'collateral',  label: 'Collateral',  href: 'Collateral.html',  icon: '⛨' },
  { id: 'liquidation', label: 'Liquidation', href: 'Liquidation.html', icon: '✖' },
];
window.PAGES = PAGES;

function navTo(id) {
  const p = PAGES.find(x => x.id === id);
  if (!p) return;
  if (typeof showNavSplash === 'function') showNavSplash();
  window.location.href = p.href;
}
window.navTo = navTo;

function Topbar({ title, onOpenCmdk, theme, setTheme }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-brand">
          <img src="assets/icon.png" alt="Datum Labs" onError={e => e.currentTarget.style.display='none'} />
          <span className="topbar-brand-name">datum<span style={{ color: 'var(--orange)' }}>labs</span></span>
        </div>
        <span className="topbar-terminal">
          <span className="prompt">❯</span>
          <span>{title}</span>
        </span>
      </div>
      <div className="topbar-right">
        <button className="cmdk-trigger" onClick={onOpenCmdk}>
          <span>🔍 Search protocols, markets…</span>
          <kbd>⌘K</kbd>
        </button>
        <span className="live-pill"><span className="dot" />LIVE · 2s ago</span>
        <div className="theme-toggle" role="tablist" aria-label="Theme">
          <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} title="Light">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          </button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} title="Dark">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
        </div>
      </div>
    </header>
  );
}

function Sidebar({ current }) {
  const D = window.SUI_LENDING_DATA;
  const protoCount = D?.protocols.length ?? 5;
  const marketCount = (D?.pools.length ?? 0) + (D?.vaults.length ?? 0);

  const sections = [
    {
      label: 'Sui Lending',
      items: [
        { ...PAGES[0], count: null },
        { ...PAGES[1], count: String(protoCount) },
        { ...PAGES[2], count: String(marketCount) },
        { ...PAGES[3], count: null },
        { ...PAGES[4], count: null },
        { ...PAGES[5], count: null },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { id: 'methodology', icon: '§', label: 'Methodology', href: '#', count: null },
        { id: 'connectors',  icon: '⇆', label: 'Data Sources', href: '#', count: null },
      ],
    },
  ];

  return (
    <aside className="sidebar">
      {sections.map(sec => (
        <div key={sec.label}>
          <div className="sidebar-section-label">{sec.label}</div>
          {sec.items.map(it => (
            <a key={it.id} className={`nav-item ${current === it.id ? 'active' : ''}`}
               onClick={() => it.href && it.href !== '#' && navTo(it.id)}
               style={{ cursor: it.href === '#' ? 'default' : 'pointer' }}>
              <span className="nav-icon">{it.icon}</span>
              <span>{it.label}</span>
              {it.count && <span className="nav-count">{it.count}</span>}
            </a>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 'auto', padding: '16px 10px 8px', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-dim)', letterSpacing: '0.1em' }}>BUILT WITH</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-muted)', marginTop: 3 }}>
          @datumlabs/<span style={{ color: 'var(--orange)' }}>dashboard-kit</span>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-dim)', marginTop: 3 }}>sui-lending v0.1.0</div>
      </div>
    </aside>
  );
}

function StatusBar() {
  const [tick, setTick] = useStateS(0);
  useEffectS(() => {
    const t = setInterval(() => setTick(x => x + 1), 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="statusbar">
      <div className="left">
        <span style={{ color: 'var(--orange)' }}>❯</span>
        <span>datumlabs.xyz / sui-lending</span>
        <span className="sep">│</span>
        <span>cache: <span style={{ color: 'var(--green)' }}>healthy</span></span>
        <span className="sep">│</span>
        <span>connectors: 5/5</span>
      </div>
      <div className="right">
        <span>checkpoint #{(48201930 + tick).toLocaleString()}</span>
        <span className="sep">│</span>
        <span>ref gas 750 mist</span>
        <span className="sep">│</span>
        <span>Sui mainnet</span>
      </div>
    </div>
  );
}

function Ticker({ items }) {
  const doubled = [...items, ...items];
  return (
    <div className="ticker">
      <div className="ticker-label">MKT</div>
      <div className="ticker-track">
        {doubled.map((it, i) => (
          <div key={i} className="ticker-item">
            <span className="sym">{it.sym}</span>
            <span>{it.unit === 'gwei' ? `${it.price.toFixed(1)} gwei` : it.unit === 'M' ? `$${it.price.toFixed(1)}M` : `$${it.price < 10 ? it.price.toFixed(4) : it.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</span>
            <span className={it.ch > 0 ? 'up' : it.ch < 0 ? 'down' : ''}>
              {it.ch > 0 ? '▲' : it.ch < 0 ? '▼' : '·'} {Math.abs(it.ch).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandPalette({ open, onClose, protocols, pools }) {
  const [q, setQ] = useStateS('');
  const [active, setActive] = useStateS(0);
  const inputRef = useRefS(null);

  useEffectS(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
      setQ(''); setActive(0);
    }
  }, [open]);

  const groups = [
    { group: 'Pages', items: PAGES.map(p => ({ icon: p.icon, label: p.label, meta: '→', act: () => navTo(p.id) })) },
    { group: 'Protocols', items: protocols.map(p => ({ icon: '◉', label: p.name, meta: p.archetype.toUpperCase(), act: () => { window.location.href = `Protocol.html?protocol=${p.id}`; } })) },
    { group: 'Markets', items: pools.slice(0, 12).map(p => ({ icon: p.sym.slice(0,2), label: `${p.sym} on ${p.protocol}`, meta: p.sym, act: () => {} })) },
  ];

  const flat = [];
  groups.forEach(g => g.items
    .filter(it => !q || it.label.toLowerCase().includes(q.toLowerCase()))
    .forEach(it => flat.push({ group: g.group, ...it })));

  const onKey = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    if (e.key === 'Enter')     { flat[active]?.act(); onClose(); }
  };

  let renderedGroups = {};
  flat.forEach(it => { renderedGroups[it.group] = renderedGroups[it.group] || []; renderedGroups[it.group].push(it); });

  return (
    <div className={`cmdk-backdrop ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <span style={{ color: 'var(--fg-muted)' }}>❯</span>
          <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} placeholder="Search or jump to…" />
          <kbd style={{ fontSize: 10, color: 'var(--fg-dim)' }}>ESC</kbd>
        </div>
        <div className="cmdk-list">
          {Object.keys(renderedGroups).map(g => (
            <div key={g}>
              <div className="cmdk-group-label">{g}</div>
              {renderedGroups[g].map((it, idx) => {
                const globalIdx = flat.indexOf(it);
                return (
                  <div key={idx} className={`cmdk-item ${globalIdx === active ? 'active' : ''}`}
                    onMouseEnter={() => setActive(globalIdx)}
                    onClick={() => { it.act(); onClose(); }}>
                    <span className="icon">{it.icon}</span>
                    <span>{it.label}</span>
                    <span className="meta">{it.meta}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div style={{ padding: 20, color: 'var(--fg-muted)', fontSize: 12 }}>No results</div>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Topbar, Sidebar, StatusBar, Ticker, CommandPalette, PAGES, navTo });
