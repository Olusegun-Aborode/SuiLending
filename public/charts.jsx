// Chart primitives — tiny SVG components, no external deps.
// Usage: pass series, width, height. Interactivity via inline handlers.

const { useState, useRef, useMemo, useEffect, useCallback } = React;

// ── Helpers ──────────────────────────────────────────────
const fmtUSD = (v, digits = 2) => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(digits)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(digits)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(digits)}K`;
  return `$${v.toFixed(digits)}`;
};
const fmtNum = (v, d = 2) => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(d)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(d)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(d)}K`;
  return v.toFixed(d);
};
const fmtPct = (v, d = 2) => `${v.toFixed(d)}%`;
const daysAgoLabel = (offsetFromNow, totalDays) => {
  const ago = totalDays - 1 - offsetFromNow;
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return `${ago}d ago`;
};
window.fmtUSD = fmtUSD; window.fmtNum = fmtNum; window.fmtPct = fmtPct;

// ── AreaChart ────────────────────────────────────────────
// ── Chart watermark ─────────────────────────────────────
function ChartWatermark({ x, y }) {
  return (
    <text x={x} y={y} textAnchor="end" fontFamily="var(--font-mono)"
      fontSize="11" fill="var(--fg-muted)" opacity="0.14" style={{ pointerEvents: 'none', letterSpacing: '0.12em' }}>
      DATUM LABS · AETHER
    </text>
  );
}

// series: [{ name, color, values: number[] }, ...]
// stacked: boolean
function AreaChart({ series, stacked = false, width = 800, height = 280, formatter = fmtUSD, valueSuffix = '', overlayCompare = null }) {
  const padL = 54, padR = 18, padT = 12, padB = 28;
  const w = width, h = height;
  const iw = w - padL - padR, ih = h - padT - padB;
  // hover carries: i (data index), x (svg x of the data point), my (raw mouse y in
  // SVG-space) so the tooltip can follow the cursor vertically. The previous
  // version pinned the tooltip at top:10 which sat on top of the data near the
  // peak of the chart. Tracking my fixes that.
  const [hover, setHover] = useState(null);

  const len = series[0]?.values.length || 0;
  if (!len) return null;

  // Stack if needed
  const stacked_vals = useMemo(() => {
    if (!stacked) return series.map(s => s.values);
    const stacks = series.map(() => new Array(len).fill(0));
    for (let i = 0; i < len; i++) {
      let acc = 0;
      for (let s = 0; s < series.length; s++) {
        acc += series[s].values[i];
        stacks[s][i] = acc;
      }
    }
    return stacks;
  }, [series, stacked, len]);

  const maxY = useMemo(() => {
    let m = 0;
    if (stacked) {
      for (let i = 0; i < len; i++) m = Math.max(m, stacked_vals[stacked_vals.length - 1][i]);
    } else {
      series.forEach(s => s.values.forEach(v => m = Math.max(m, v)));
      if (overlayCompare) overlayCompare.forEach(s => s.values.forEach(v => m = Math.max(m, v)));
    }
    return m * 1.1;
  }, [series, stacked, len, overlayCompare]);

  const x = (i) => padL + (i / (len - 1)) * iw;
  const y = (v) => padT + ih - (v / maxY) * ih;

  // Build paths
  const paths = series.map((s, si) => {
    const vals = stacked ? stacked_vals[si] : s.values;
    const prev = stacked && si > 0 ? stacked_vals[si - 1] : null;
    let d = `M ${x(0)} ${y(vals[0])}`;
    for (let i = 1; i < len; i++) d += ` L ${x(i)} ${y(vals[i])}`;
    let area = d;
    if (prev) {
      for (let i = len - 1; i >= 0; i--) area += ` L ${x(i)} ${y(prev[i])}`;
      area += ' Z';
    } else {
      area += ` L ${x(len - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;
    }
    return { d, area, color: s.color };
  });

  const overlayPaths = (overlayCompare || []).map(s => {
    let d = `M ${x(0)} ${y(s.values[0])}`;
    for (let i = 1; i < s.values.length; i++) d += ` L ${x(i)} ${y(s.values[i])}`;
    return { d, color: s.color, name: s.name, values: s.values };
  });

  // Y ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => maxY * t);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Convert client coords → svg viewBox coords (rect width may differ from
    // viewBox `w` because the SVG is `width="100%"`). Scaling both axes by the
    // same factor keeps the cursor-following tooltip honest across breakpoints.
    const sx = w / rect.width;
    const sy = h / rect.height;
    const mx = (e.clientX - rect.left) * sx;
    const my = (e.clientY - rect.top) * sy;
    const rel = (mx - padL) / iw;
    if (rel < -0.02 || rel > 1.02) { setHover(null); return; }
    const i = Math.max(0, Math.min(len - 1, Math.round(rel * (len - 1))));
    setHover({ i, x: x(i), my });
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        style={{ display: 'block', cursor: 'crosshair' }}
      >
        {/* grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-muted)">
              {formatter(t, t >= 1000 ? 1 : 2)}{valueSuffix}
            </text>
          </g>
        ))}
        {/* x labels */}
        {[0, Math.floor(len/4), Math.floor(len/2), Math.floor(3*len/4), len-1].map(i => (
          <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-muted)">
            {daysAgoLabel(i, len)}
          </text>
        ))}
        {/* areas and lines */}
        {paths.map((p, i) => (
          <g key={i}>
            <path d={p.area} fill={p.color} opacity={stacked ? 0.85 : 0.12} />
            <path d={p.d} fill="none" stroke={p.color} strokeWidth={stacked ? 0 : 2} strokeLinejoin="round" />
          </g>
        ))}
        {/* overlay compare */}
        {overlayPaths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth="2" strokeDasharray="4 3" />
        ))}
        {/* Hover */}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={padT} y2={padT + ih} stroke="var(--orange)" strokeWidth="1" opacity="0.7" />
            {series.map((s, si) => {
              const vals = stacked ? stacked_vals[si] : s.values;
              return <circle key={si} cx={hover.x} cy={y(vals[hover.i])} r="3.5" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />;
            })}
            {overlayPaths.map((p, i) => (
              <circle key={i} cx={hover.x} cy={y(p.values[hover.i])} r="3.5" fill={p.color} stroke="var(--surface)" strokeWidth="1.5" />
            ))}
          </g>
        )}
        <ChartWatermark x={w - 20} y={padT + 16} />
      </svg>
      {hover && (() => {
        // Convert tooltip x/y from svg-space back to css px so absolute
        // positioning lines up with the rendered chart at any width. Right-edge
        // clamp keeps the tooltip readable; vertical clamp avoids the tooltip
        // hanging off the bottom of the panel.
        const cssX = Math.min((hover.x + 14) / w * 100, 100 - 22);
        const cssY = Math.max(2, Math.min((hover.my - 12) / h * 100, 100 - 30));
        const total = series.reduce((s, ser) => s + ser.values[hover.i], 0);
        return (
          <div className="chart-tooltip" style={{
            left: `${cssX}%`,
            top: `${cssY}%`,
          }}>
            <div className="t-date">{daysAgoLabel(hover.i, len)}</div>
            {series.map(s => (
              <div key={s.name} className="t-row">
                <span className="t-label"><span className="legend-swatch" style={{ background: s.color, marginRight: 6 }} />{s.name}</span>
                <span>{formatter(s.values[hover.i], 2)}{valueSuffix}</span>
              </div>
            ))}
            {overlayPaths.map(p => (
              <div key={p.name} className="t-row">
                <span className="t-label"><span className="legend-swatch" style={{ background: p.color, marginRight: 6, borderStyle: 'dashed' }} />{p.name}</span>
                <span>{formatter(p.values[hover.i], 2)}{valueSuffix}</span>
              </div>
            ))}
            {/* Total row — only meaningful for stacked charts (otherwise it'd
                be the sum of unrelated series). Keeps the tooltip honest about
                what's an aggregate vs. a slice. */}
            {stacked && series.length > 1 && (
              <div className="t-row" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
                <span className="t-label">TOTAL</span>
                <span>{formatter(total, 2)}{valueSuffix}</span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── StackedBarChart ──────────────────────────────────────
//
// Daily Flows uses this. Hover behaviour notes:
//   - hit-detection on the WHOLE inner chart area (not per-bar onMouseEnter)
//     so the tooltip doesn't flicker off in the gap between thin bars
//   - coords are converted from client px → svg viewBox units before
//     positioning the tooltip, so the cursor-following position is honest
//     across responsive widths (svg renders at width="100%" but uses a
//     fixed viewBox)
//   - vertical indicator line + circle-on-cursor mark the hovered column
//   - keyLabels prop pretty-prints raw stack keys ("supply" → "Supply")
//
function StackedBarChart({ data, keys, colors, width = 800, height = 220, formatter = fmtUSD, keyLabels }) {
  const padL = 54, padR = 18, padT = 12, padB = 26;
  const w = width, h = height;
  const iw = w - padL - padR, ih = h - padT - padB;
  // hover: { i: data index, x: svg-x of column center, my: svg-y of cursor }
  const [hover, setHover] = useState(null);

  const totals = data.map(d => keys.reduce((a, k) => a + d[k], 0));
  const maxY = Math.max(...totals) * 1.1;
  const n = data.length;
  const colW = iw / n;             // total column width (bar + gap)
  const bw = colW * 0.7;
  const gap = colW * 0.3;
  const x = (i) => padL + i * colW + gap / 2;
  const y = (v) => padT + ih - (v / maxY) * ih;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => maxY * t);

  // Translate cursor position → which column it falls in. Works in the gap
  // between bars too, so the tooltip stays glued to the nearest column
  // instead of flickering on/off as the cursor crosses gaps.
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = w / rect.width;
    const sy = h / rect.height;
    const mx = (e.clientX - rect.left) * sx;
    const my = (e.clientY - rect.top) * sy;
    if (mx < padL - 4 || mx > padL + iw + 4) { setHover(null); return; }
    const idx = Math.max(0, Math.min(n - 1, Math.floor((mx - padL) / colW)));
    setHover({ i: idx, x: x(idx) + bw / 2, my });
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}
        style={{ display: 'block', cursor: 'crosshair' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-muted)">
              {formatter(t, 0)}
            </text>
          </g>
        ))}
        {[0, Math.floor(n/4), Math.floor(n/2), Math.floor(3*n/4), n-1].map(i => (
          <text key={i} x={x(i) + bw / 2} y={h - 8} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-muted)">
            {daysAgoLabel(i, n)}
          </text>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          const dim = hover && hover.i !== i;
          return (
            <g key={i}>
              {keys.map((k, ki) => {
                const v = d[k];
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                return (
                  <rect key={k}
                    x={x(i)} y={y1}
                    width={bw} height={Math.max(0.5, y0 - y1)}
                    fill={colors[ki]}
                    opacity={dim ? 0.35 : 0.92}
                  />
                );
              })}
            </g>
          );
        })}
        {/* Vertical indicator line at the hovered column, mirrors AreaChart's
            cursor mark so users have a clear sense of "which day am I on". */}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={padT} y2={padT + ih}
              stroke="var(--orange)" strokeWidth="1" opacity="0.7" />
            <circle cx={hover.x} cy={y(totals[hover.i])} r="3.5"
              fill="var(--orange)" stroke="var(--surface)" strokeWidth="1.5" />
          </g>
        )}
        <ChartWatermark x={w - 20} y={padT + 16} />
      </svg>
      {hover && (() => {
        // Convert svg-space hover position → CSS percentages so absolute
        // positioning over the SVG holds at any rendered width. Vertical
        // clamp keeps the tip from hanging off the panel.
        const cssX = Math.min((hover.x + 14) / w * 100, 100 - 24);
        const cssY = Math.max(2, Math.min((hover.my - 12) / h * 100, 100 - 36));
        return (
          <div className="chart-tooltip" style={{
            left: `${cssX}%`,
            top: `${cssY}%`,
          }}>
            <div className="t-date">{daysAgoLabel(hover.i, n)}</div>
            {keys.map((k, ki) => (
              <div key={k} className="t-row">
                <span className="t-label">
                  <span className="legend-swatch" style={{ background: colors[ki], marginRight: 6 }} />
                  {(keyLabels && keyLabels[k]) || (k.charAt(0).toUpperCase() + k.slice(1))}
                </span>
                <span>{formatter(data[hover.i][k], 1)}</span>
              </div>
            ))}
            <div className="t-row" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
              <span className="t-label">TOTAL</span>
              <span>{formatter(totals[hover.i], 1)}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Treemap ──────────────────────────────────────────────
// Simple squarified treemap
function Treemap({ items, width = 400, height = 280, onSelect, selectedId, formatter, valueLabel = '' }) {
  // items: [{id, name, value, color}]
  const total = items.reduce((a, b) => a + b.value, 0);
  // Hover state for the tooltip. Tracks both the rect being hovered (for
  // dim-others styling) and the cursor px so the tooltip follows the mouse.
  const [hover, setHover] = useState(null);
  // Default formatter mirrors the inline labels: values are millions, shown
  // as $X.XM. Callers can override (e.g. counts vs. dollars).
  const fmt = formatter || ((v) => fmtUSD(v * 1e6, 2));

  function squarify(items, x, y, w, h) {
    if (!items.length) return [];
    if (items.length === 1) return [{ ...items[0], x, y, w, h }];
    const totalV = items.reduce((a, b) => a + b.value, 0);
    // Take items one at a time, decide row when aspect starts getting worse
    const shortSide = Math.min(w, h);
    let row = [];
    let rest = items.slice();
    let best = Infinity;
    while (rest.length) {
      const candidate = [...row, rest[0]];
      const sum = candidate.reduce((a, b) => a + b.value, 0);
      const scale = (shortSide * shortSide) / (sum * sum / totalV * w * h);
      const worst = candidate.reduce((m, it) => {
        const area = it.value / totalV * w * h;
        const s = scale;
        return Math.max(m, Math.max(s * area, 1 / (s * area)));
      }, 0);
      if (worst > best && row.length) break;
      row.push(rest.shift());
      best = worst;
    }
    const sumRow = row.reduce((a, b) => a + b.value, 0);
    const rects = [];
    if (w < h) {
      const rowH = (sumRow / totalV) * h * (w * h) / (w * h);
      const rh = sumRow / totalV * h;
      let cx = x;
      row.forEach(it => {
        const rw = it.value / sumRow * w;
        rects.push({ ...it, x: cx, y, w: rw, h: rh });
        cx += rw;
      });
      rects.push(...squarify(rest, x, y + rh, w, h - rh));
    } else {
      const rw = sumRow / totalV * w;
      let cy = y;
      row.forEach(it => {
        const rh = it.value / sumRow * h;
        rects.push({ ...it, x, y: cy, w: rw, h: rh });
        cy += rh;
      });
      rects.push(...squarify(rest, x + rw, y, w - rw, h));
    }
    return rects;
  }

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const rects = squarify(sorted, 0, 0, width, height);

  // Track cursor position in svg-space so tooltip follows.
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = width / rect.width, sy = height / rect.height;
    const mx = (e.clientX - rect.left) * sx;
    const my = (e.clientY - rect.top) * sy;
    // Find which rect contains the cursor. The squarify rects are non-overlapping
    // so first hit wins; with ~5 protocols this is cheap enough every move.
    const hit = rects.find(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
    if (hit) setHover({ id: hit.id, mx, my });
    else setHover(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: 'block' }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      >
        {rects.map(r => {
          const pct = (r.value / total * 100).toFixed(1);
          const big = r.w > 70 && r.h > 40;
          const sel = selectedId === r.id;
          const hov = hover && hover.id === r.id;
          // Dim non-hovered tiles slightly so the cursor-target pops without
          // making everything else illegible.
          const op = sel ? 0.95 : (hov ? 0.95 : (hover ? 0.55 : 0.82));
          return (
            <g key={r.id} style={{ cursor: 'pointer' }} onClick={() => onSelect && onSelect(r.id)}>
              <rect x={r.x + 1} y={r.y + 1} width={Math.max(0, r.w - 2)} height={Math.max(0, r.h - 2)}
                fill={r.color} opacity={op}
                stroke={sel ? 'var(--fg)' : (hov ? 'var(--fg)' : 'transparent')} strokeWidth={sel || hov ? 2 : 0} rx="3" />
              {big && (
                <>
                  <text x={r.x + 10} y={r.y + 20} fontSize="12" fontWeight="600" fill="white" fontFamily="var(--font-mono)">{r.name}</text>
                  <text x={r.x + 10} y={r.y + 36} fontSize="11" fill="white" opacity="0.85" fontFamily="var(--font-mono)">{fmt(r.value)}</text>
                  <text x={r.x + 10} y={r.y + 50} fontSize="10" fill="white" opacity="0.7" fontFamily="var(--font-mono)">{pct}%</text>
                </>
              )}
              {!big && r.w > 40 && r.h > 20 && (
                <text x={r.x + 6} y={r.y + 16} fontSize="10" fontWeight="600" fill="white" fontFamily="var(--font-mono)">{r.name}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (() => {
        const r = rects.find(x => x.id === hover.id);
        if (!r) return null;
        const cssX = Math.min((hover.mx + 14) / width * 100, 100 - 30);
        const cssY = Math.max(2, Math.min((hover.my - 12) / height * 100, 100 - 30));
        const pct = (r.value / total * 100).toFixed(1);
        return (
          <div className="chart-tooltip" style={{ left: `${cssX}%`, top: `${cssY}%` }}>
            <div className="t-date">{r.name}</div>
            <div className="t-row">
              <span className="t-label">{valueLabel || 'Value'}</span>
              <span>{fmt(r.value)}</span>
            </div>
            <div className="t-row">
              <span className="t-label">Share</span>
              <span>{pct}%</span>
            </div>
            <div className="t-row" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
              <span className="t-label">TOTAL</span>
              <span>{fmt(total)}</span>
            </div>
            {/* Optional methodology note — surfaces when a tile's headline TVL
                comes from a different source than the protocol's own UI (e.g.
                Bucket displayed using DefiLlama's published number while
                Bucket's own UI shows a slightly lower figure). Renders as a
                small wrapped note under the totals. */}
            {r.note && (
              <div style={{
                marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.2)',
                fontSize: 10, lineHeight: 1.35, opacity: 0.8, maxWidth: 260, whiteSpace: 'normal',
              }}>
                {r.note}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Sparkline ────────────────────────────────────────────
function Sparkline({ values, color = 'var(--orange)', width = 90, height = 32, filled = true }) {
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const d = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {filled && <path d={`${d} L ${width} ${height} L 0 ${height} Z`} fill={color} opacity="0.14" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

// ── Horizontal bar leaderboard ───────────────────────────
function Leaderboard({ items, color = 'var(--orange)', format = fmtUSD }) {
  const max = Math.max(...items.map(i => i.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it, idx) => (
        <div key={it.id || it.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)', fontSize: 11, width: 16 }}>{String(idx + 1).padStart(2, '0')}</span>
              {it.dot && <span className="legend-swatch" style={{ background: it.dot }} />}
              <span style={{ fontWeight: 500 }}>{it.name}</span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', fontSize: 12 }}>{format(it.value)}</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${it.value / max * 100}%`, background: it.dot || color, borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Heatmap ──────────────────────────────────────────────
function Heatmap({ data }) {
  // data: 7 rows x 24 cols, values 0..1
  const days = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '36px repeat(24, 1fr)', gap: 2, alignItems: 'center' }}>
        <div />
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--fg-dim)', textAlign: 'center', opacity: h % 4 === 0 ? 1 : 0 }}>
            {String(h).padStart(2, '0')}
          </div>
        ))}
        {data.map((row, d) => (
          <React.Fragment key={d}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--fg-muted)' }}>{days[d]}</div>
            {row.map((v, h) => (
              <div key={h} title={`${days[d]} ${h}:00 — ${Math.round(v*100)}% activity`}
                style={{
                  aspectRatio: '1 / 1',
                  background: `rgba(255,107,53,${0.08 + v * 0.9})`,
                  borderRadius: 2,
                  cursor: 'pointer',
                  transition: 'transform 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.4)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>
        <span>LOW</span>
        {[0.1, 0.3, 0.5, 0.7, 0.9].map(v => (
          <span key={v} style={{ width: 14, height: 10, background: `rgba(255,107,53,${0.08 + v * 0.9})`, borderRadius: 2, display: 'inline-block' }} />
        ))}
        <span>HIGH</span>
      </div>
    </div>
  );
}

// ── Candlestick ──────────────────────────────────────────
function Candlestick({ data, width = 400, height = 180 }) {
  const padL = 40, padR = 10, padT = 8, padB = 20;
  const iw = width - padL - padR, ih = height - padT - padB;
  const [hover, setHover] = useState(null);

  const hi = Math.max(...data.map(d => d.h));
  const lo = Math.min(...data.map(d => d.l));
  const range = hi - lo;
  const y = (v) => padT + ih - ((v - lo) / range) * ih;
  const bw = iw / data.length * 0.7;
  const gap = iw / data.length * 0.3;
  const x = (i) => padL + i * (iw / data.length) + gap / 2;

  const ticks = [lo, lo + range * 0.5, hi];

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--fg-muted)">${t.toFixed(2)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const up = d.c >= d.o;
          const color = up ? 'var(--green)' : 'var(--red)';
          const bodyY = y(Math.max(d.o, d.c));
          const bodyH = Math.max(1, Math.abs(y(d.o) - y(d.c)));
          return (
            <g key={i} onMouseEnter={() => setHover({ i, x: x(i) + bw / 2 })}>
              <line x1={x(i) + bw / 2} x2={x(i) + bw / 2} y1={y(d.h)} y2={y(d.l)} stroke={color} strokeWidth="1" />
              <rect x={x(i)} y={bodyY} width={bw} height={bodyH} fill={color} opacity={hover && hover.i !== i ? 0.4 : 0.9} />
              <rect x={x(i) - 1} y={padT} width={bw + 2} height={ih} fill="transparent" />
            </g>
          );
        })}
        <ChartWatermark x={width - 12} y={padT + 14} />
      </svg>
      {hover && (
        <div className="chart-tooltip" style={{ left: Math.min(hover.x + 10, width - 140), top: 4 }}>
          <div className="t-date">Day -{data.length - 1 - hover.i}</div>
          <div className="t-row"><span className="t-label">Open</span><span>${data[hover.i].o.toFixed(3)}</span></div>
          <div className="t-row"><span className="t-label">High</span><span>${data[hover.i].h.toFixed(3)}</span></div>
          <div className="t-row"><span className="t-label">Low</span><span>${data[hover.i].l.toFixed(3)}</span></div>
          <div className="t-row"><span className="t-label">Close</span><span>${data[hover.i].c.toFixed(3)}</span></div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AreaChart, StackedBarChart, Treemap, Sparkline, Leaderboard, Heatmap, Candlestick });
