'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Moon, Sun } from 'lucide-react';
import { DEFAULTS, TWEAK_KEYS, type Aesthetic, type Density, type Theme } from './tweaks-context';

interface NavItem {
  href: string;
  label: string;
  icon?: string;
  badge?: string | number;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

interface NaviShellProps {
  protocolName: string;
  protocol: string;
  sections: NavSection[];
  children: React.ReactNode;
}

/**
 * NaviShell — the topbar / sidebar / statusbar layout ported from the Datum
 * Labs Dashboard SDK (shell.jsx). Theme / aesthetic / density persist in
 * localStorage and mirror to body data-attrs before first paint via the inline
 * script embedded in app/layout.tsx.
 */
export default function NaviShell({ protocolName, protocol, sections, children }: NaviShellProps) {
  const pathname = usePathname();

  const [theme, setTheme] = useState<Theme>(DEFAULTS.theme);
  const [aesthetic, setAesthetic] = useState<Aesthetic>(DEFAULTS.aesthetic);
  const [density, setDensity] = useState<Density>(DEFAULTS.density);

  // Hydrate from localStorage on mount. This intentionally sets state inside
  // an effect — it's the SSR-safe pattern for reading client-only storage —
  // so we silence the react-hooks/set-state-in-effect rule for this block.
  // (The inline boot script in layout.tsx already sets body data-attrs before
  // paint, so users never see a flash of the default theme.)
  useEffect(() => {
    const t = (localStorage.getItem(TWEAK_KEYS.theme) as Theme) ?? DEFAULTS.theme;
    const a =
      (localStorage.getItem(TWEAK_KEYS.aesthetic) as Aesthetic) ?? DEFAULTS.aesthetic;
    const d = (localStorage.getItem(TWEAK_KEYS.density) as Density) ?? DEFAULTS.density;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(t);
    setAesthetic(a);
    setDensity(d);
  }, []);

  // Mirror into <body> data-attrs so CSS tokens re-cascade.
  useEffect(() => {
    document.body.dataset.theme = theme;
    document.body.dataset.aesthetic = aesthetic;
    document.body.dataset.density = density;
    localStorage.setItem(TWEAK_KEYS.theme, theme);
    localStorage.setItem(TWEAK_KEYS.aesthetic, aesthetic);
    localStorage.setItem(TWEAK_KEYS.density, density);
  }, [theme, aesthetic, density]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);

  // Status bar clock ticks block height for vibe only — nothing on chain.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(id);
  }, []);

  const block = useMemo(() => 20_482_193 + tick, [tick]);

  return (
    <div className="shell">
      {/* ─── Topbar ─── */}
      <header className="topbar">
        <div className="topbar-left">
          <Link href={`/${protocol}/overview`} className="topbar-brand">
            <Image
              src="/branding/icon.png"
              alt="Datum Labs"
              width={22}
              height={22}
              style={{ borderRadius: 4 }}
            />
            <span className="topbar-brand-name">
              datum<span style={{ color: 'var(--orange)' }}>labs</span>
            </span>
          </Link>
          <span className="topbar-terminal">
            <span className="prompt">❯</span>
            <span>{protocolName} Lending Terminal</span>
          </span>
        </div>
        <div className="topbar-right">
          <span className="live-pill">
            <span className="dot" /> LIVE
          </span>
          <div className="theme-toggle" role="tablist" aria-label="Theme">
            <button
              className={theme === 'light' ? 'active' : ''}
              onClick={() => setTheme('light')}
              title="Light"
              type="button"
            >
              <Sun size={12} />
            </button>
            <button
              className={theme === 'dark' ? 'active' : ''}
              onClick={() => setTheme('dark')}
              title="Dark"
              type="button"
            >
              <Moon size={12} />
            </button>
          </div>
        </div>
      </header>

      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        {sections.map((sec) => (
          <div key={sec.label}>
            <div className="sidebar-section-label">{sec.label}</div>
            {sec.items.map((it) => {
              const active =
                pathname === it.href || (it.href !== '/' && pathname?.startsWith(it.href));
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`nav-item ${active ? 'active' : ''}`}
                >
                  {it.icon && <span className="nav-icon">{it.icon}</span>}
                  <span>{it.label}</span>
                  {it.badge !== undefined && <span className="nav-count">{it.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}
        <div
          style={{
            marginTop: 'auto',
            padding: '16px 10px 8px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-dim)',
              letterSpacing: '0.1em',
            }}
          >
            BUILT WITH
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--fg-muted)',
              marginTop: 3,
            }}
          >
            @datumlabs/<span style={{ color: 'var(--orange)' }}>dashboard-kit</span>
          </div>
        </div>
      </aside>

      {/* ─── Main ─── */}
      <main className="main">{children}</main>

      {/* ─── Status bar ─── */}
      <footer className="statusbar">
        <div className="left">
          <span style={{ color: 'var(--orange)' }}>❯</span>
          <span>datumlabs.xyz</span>
          <span className="sep">│</span>
          <span>
            cache: <span style={{ color: 'var(--green)' }}>healthy</span>
          </span>
          <span className="sep">│</span>
          <span>chain: Sui</span>
        </div>
        <div className="right">
          <span>block #{block.toLocaleString()}</span>
          <span className="sep">│</span>
          <span>Powered by DatumLabs</span>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={toggleTheme}
            aria-label="Toggle theme"
            type="button"
          >
            {theme === 'light' ? <Moon size={12} /> : <Sun size={12} />}
          </button>
        </div>
      </footer>
    </div>
  );
}
