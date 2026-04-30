'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';
import { getAssetColor } from '@/lib/utils';

interface AssetFilterProps {
  /** All symbols the chart can draw, order preserved for the list. */
  symbols: string[];
  /** Symbols currently visible; undefined === all. */
  selected: string[] | undefined;
  /** Called with the new selection. `undefined` means "all". */
  onChange: (next: string[] | undefined) => void;
  /** Optional trigger label override (default: "Assets"). */
  label?: string;
}

/**
 * AssetFilter — dropdown multi-select for picking which assets a chart
 * should draw. "All" maps to `undefined` so the chart can distinguish
 * "show everything" from "show nothing" without needing to know the
 * whole asset universe. Closes on outside click or Escape.
 */
export default function AssetFilter({
  symbols,
  selected,
  onChange,
  label = 'Assets',
}: AssetFilterProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isAll = selected === undefined;
  const selectedSet = new Set(isAll ? symbols : selected ?? []);

  const summary = isAll
    ? 'All'
    : selected!.length === 0
    ? 'None'
    : selected!.length === 1
    ? selected![0]
    : `${selected!.length} selected`;

  function toggle(sym: string) {
    const current = isAll ? new Set(symbols) : new Set(selected ?? []);
    if (current.has(sym)) current.delete(sym);
    else current.add(sym);
    // Collapse "everything selected" back to the `undefined` (All) state
    // so the chart knows to treat it as the implicit-default case.
    if (current.size === symbols.length) onChange(undefined);
    else onChange(Array.from(current));
  }

  function selectAll() {
    onChange(undefined);
  }
  function clearAll() {
    onChange([]);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`dropdown-trigger ${isAll ? '' : 'active'}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span style={{ color: 'var(--fg-muted)' }}>{label}:</span>
        <span>{summary}</span>
        <ChevronDown size={10} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.12)',
            minWidth: 220,
            maxHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 30,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
          }}
        >
          {/* Shortcut row */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={selectAll}
              className="time-btn"
              style={{ flex: 1 }}
            >
              All
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="time-btn"
              style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}
            >
              <X size={10} /> Clear
            </button>
          </div>

          {/* Scrollable list of symbols */}
          <div style={{ overflowY: 'auto', padding: 4 }}>
            {symbols.map((sym) => {
              const on = selectedSet.has(sym);
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => toggle(sym)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    width: '100%',
                    borderRadius: 5,
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--fg)',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--hover)')
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      border: `1.5px solid ${on ? 'var(--orange)' : 'var(--border-strong)'}`,
                      background: on ? 'var(--orange)' : 'transparent',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {on && <Check size={9} color="white" strokeWidth={3} />}
                  </span>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: getAssetColor(sym),
                    }}
                  />
                  <span style={{ flex: 1 }}>{sym}</span>
                </button>
              );
            })}
            {symbols.length === 0 && (
              <div style={{ padding: 12, color: 'var(--fg-muted)' }}>No assets</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
