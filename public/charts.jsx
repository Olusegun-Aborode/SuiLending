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
// markerX: optional data-index (0..len-1) at which to draw a vertical reference
//   line — used e.g. for the current-utilization marker on the IRM curve
//   (required by §6 of the analysis standard: every chart shows a current-state
//   marker where one exists).
// markerLabel: optional short label rendered above the marker line.
function AreaChart({ series, stacked = false, width = 800, height = 280, formatter = fmtUSD, valueSuffix = '', overlayCompare = null, markerX = null, markerLabel = null, xTickFormatter = null }) {
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
        {/* x labels — default formatter is "Today / Xd ago" (time-series).
            Override with xTickFormatter when the axis is something else
            (e.g. the IRM curve plots utilization 0%→100%, not time). */}
        {[0, Math.floor(len/4), Math.floor(len/2), Math.floor(3*len/4), len-1].map(i => (
          <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-muted)">
            {xTickFormatter ? xTickFormatter(i, len) : daysAgoLabel(i, len)}
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
        {/* Current-state marker (e.g. current utilization on the IRM curve).
            Rendered as a dashed vertical line with an optional label tag at
            the top. Sits behind the hover layer so the user can still inspect
            values around it. */}
        {markerX != null && markerX >= 0 && markerX < len && (
          <g pointerEvents="none">
            <line x1={x(markerX)} x2={x(markerX)} y1={padT} y2={padT + ih}
              stroke="var(--fg-muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            {markerLabel && (
              <g>
                <rect x={x(markerX) - 24} y={padT - 2} width="48" height="14" rx="2"
                  fill="var(--surface)" stroke="var(--fg-muted)" strokeWidth="0.5" />
                <text x={x(markerX)} y={padT + 8} textAnchor="middle"
                  fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg)">{markerLabel}</text>
              </g>
            )}
          </g>
        )}
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
              {/* Tiny tile escape hatch — small protocols (e.g. Scallop at
                  ~4.5% of sector TVL) used to disappear because the rect
                  was below the 40×20 label threshold. Now any tile ≥ 24×14
                  gets a compact label so every protocol stays visible. */}
              {!big && (r.w <= 40 || r.h <= 20) && r.w > 24 && r.h > 14 && (
                <text x={r.x + 4} y={r.y + 12} fontSize="9" fontWeight="600" fill="white" fontFamily="var(--font-mono)">{r.name}</text>
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

// ── Histogram ────────────────────────────────────────────
//
// Distribution primitive — ported in from the Datum Labs Dashboard SDK
// (chart.jsx as of 2026-05). Richer than the original lending-only version
// it replaced. Two accepted input shapes:
//
//   1. New SDK shape (preferred):
//        values:  number[]                — raw observations, auto-binned
//        weight:  number[]                — optional, same length as values;
//                                            bar height becomes Σ weight
//                                            instead of count (e.g. $ at risk)
//        binCount / binWidth              — control binning
//        clampRange:[lo,hi]               — fold outliers into the end bins
//        markers: [{value,label,color}]   — vertical reference lines
//        colorBands:[{from,to,color}]     — backdrop bands + per-bar colour
//        xLabel / yLabel                  — axis titles inside the SVG
//
//   2. Legacy shape (still supported for older callers):
//        bins: [{ label, count, value?, color? }]
//        referenceX, referenceLabel, countLabel, valueLabel, valueFormatter
//      Internally adapted into the new shape so the same render path runs.
//
// Tooltip shows the bin range, count, weight (if weighted), and share.
const fmtEdge = (n) => {
  if (!Number.isFinite(n)) return '∞';
  if (Math.abs(n) >= 1000) return fmtNum(n, 1);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};
function Histogram({
  // New SDK API
  values, bins: preBinsRaw, weight, binCount = 20, binWidth,
  clampRange, markers = [], colorBands = [],
  xLabel, yLabel, valueFormat = fmtUSD,
  // Visual
  width = 480, height = 220, color = 'var(--chart-1)',
  // Legacy API (older callers may still pass this shape — translated below)
  referenceX = null, referenceLabel = null,
  countLabel = 'Count', valueLabel,
  valueFormatter,
}) {
  // Translate legacy `[{label, count, value, color}]` bins to the SDK's
  // `[{x0, x1, count, weight}]` shape so the new render path can handle both.
  // We assume legacy bins are sequential (one per ordinal index); x0/x1 are
  // their indices so axis labels still line up. Legacy `referenceX` (a bin
  // index) becomes a marker at the same index.
  let preBins = preBinsRaw;
  const legacyMode = !preBins && !values && Array.isArray(arguments[0]?.bins);
  if (legacyMode) {
    const raw = arguments[0].bins;
    preBins = raw.map((b, i) => ({
      x0: i, x1: i + 1, count: b.count || 0, weight: b.value ?? b.count ?? 0,
      _label: b.label, _color: b.color,
    }));
    if (referenceX != null && referenceX >= 0 && referenceX < raw.length) {
      markers = [{ value: referenceX + 0.5, label: referenceLabel ?? 'ref', color: 'var(--red)' }, ...markers];
    }
  }

  const padL = 50, padR = 18, padT = 16, padB = xLabel ? 38 : 28;
  const iw = width - padL - padR, ih = height - padT - padB;
  const [hover, setHover] = useState(null);

  const weighted = !!(weight && weight.length) || !!(preBins && preBins.some(b => b.weight != null && b.weight !== b.count));

  const { bins, total } = useMemo(() => {
    let outBins;
    if (preBins && preBins.length) {
      outBins = preBins.map(b => ({
        x0: b.x0, x1: b.x1,
        count: b.count ?? 0,
        weight: b.weight ?? b.count ?? 0,
        _label: b._label, _color: b._color,
      }));
    } else {
      const vals = values || [];
      let lo, hi;
      if (clampRange) { lo = clampRange[0]; hi = clampRange[1]; }
      else { lo = vals.length ? Math.min(...vals) : 0; hi = vals.length ? Math.max(...vals) : 1; }
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) { lo = lo || 0; hi = lo + 1; }
      let nBins, bw;
      if (binWidth) { bw = binWidth; nBins = Math.max(1, Math.ceil((hi - lo) / bw)); }
      else { nBins = Math.max(1, Math.round(binCount)); bw = (hi - lo) / nBins; }
      outBins = Array.from({ length: nBins }, (_, i) => ({ x0: lo + i * bw, x1: lo + (i + 1) * bw, count: 0, weight: 0 }));
      vals.forEach((v, idx) => {
        const w = weighted ? (weight[idx] ?? 0) : 1;
        const cv = clampRange ? Math.max(lo, Math.min(hi - 1e-9, v)) : v;
        let bi = Math.floor((cv - lo) / bw);
        if (bi < 0) bi = 0;
        if (bi >= nBins) bi = nBins - 1;
        outBins[bi].count += 1;
        outBins[bi].weight += w;
      });
    }
    const total = outBins.reduce((a, b) => a + (weighted ? b.weight : b.count), 0) || 1;
    return { bins: outBins, total };
  }, [values, preBins, weight, binCount, binWidth, clampRange, weighted]);

  if (!bins.length) return null;

  const metric = (b) => (weighted ? b.weight : b.count);
  const maxY = (Math.max(...bins.map(metric)) || 1) * 1.1;
  const x0v = bins[0].x0, x1v = bins[bins.length - 1].x1;
  const span = (x1v - x0v) || 1;
  const xPx = (v) => padL + ((v - x0v) / span) * iw;
  const y = (v) => padT + ih - (v / maxY) * ih;

  const bandColor = (b) => {
    if (b._color) return b._color;
    if (!colorBands.length) return color;
    const c = (b.x0 + b.x1) / 2;
    const band = colorBands.find(bd => c >= bd.from && c < bd.to);
    return band ? band.color : color;
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => maxY * t);

  // x edge ticks, thinned so labels stay legible with many bins.
  // For legacy mode we prefer the supplied bin labels instead of edge numbers.
  const edgeStep = Math.max(1, Math.ceil(bins.length / 8));
  const edges = legacyMode
    ? bins.filter((_, i) => i % edgeStep === 0 || i === bins.length - 1).map((b, idx, arr) => ({ at: (b.x0 + b.x1) / 2, label: b._label ?? fmtEdge(b.x0) }))
    : bins.filter((_, i) => i % edgeStep === 0).map(b => b.x0).concat([x1v]).map(e => ({ at: e, label: fmtEdge(e) }));

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}
        style={{ display: 'block', cursor: 'crosshair' }}
        onMouseLeave={() => setHover(null)}>
        {/* y grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-muted)">
              {weighted ? valueFormat(t, t >= 1000 ? 1 : 0) : fmtNum(t, 0)}
            </text>
          </g>
        ))}
        {/* x edge ticks */}
        {edges.map((e, i) => (
          <text key={i} x={xPx(e.at)} y={height - (xLabel ? 16 : 8)} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-muted)">
            {e.label}
          </text>
        ))}
        {/* axis titles */}
        {xLabel && (
          <text x={padL + iw / 2} y={height - 1} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-dim)" style={{ letterSpacing: '0.06em' }}>{xLabel}</text>
        )}
        {yLabel && (
          <text x={12} y={padT + ih / 2} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--fg-dim)"
            transform={`rotate(-90 12 ${padT + ih / 2})`} style={{ letterSpacing: '0.06em' }}>{yLabel}</text>
        )}
        {/* colour bands (faint backdrop) */}
        {colorBands.map((bd, i) => {
          const from = Math.max(x0v, bd.from);
          const to = Math.min(x1v, Number.isFinite(bd.to) ? bd.to : x1v);
          if (to <= from) return null;
          return <rect key={i} x={xPx(from)} y={padT} width={Math.max(0, xPx(to) - xPx(from))} height={ih} fill={bd.color} opacity="0.05" />;
        })}
        {/* bars */}
        {bins.map((b, i) => {
          const bx0 = xPx(b.x0), bx1 = xPx(b.x1);
          const bw = Math.max(0, bx1 - bx0 - 1);
          const top = y(metric(b));
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={bx0 + 0.5} y={top} width={bw} height={Math.max(0, padT + ih - top)}
                fill={bandColor(b)} opacity={hover != null && hover !== i ? 0.4 : 0.85} />
              {/* full-height hit target */}
              <rect x={bx0} y={padT} width={Math.max(1, bx1 - bx0)} height={ih} fill="transparent" />
            </g>
          );
        })}
        {/* markers (vertical reference lines) */}
        {markers.filter(m => m.value >= x0v && m.value <= x1v).map((m, i) => (
          <g key={i}>
            <line x1={xPx(m.value)} x2={xPx(m.value)} y1={padT} y2={padT + ih}
              stroke={m.color || 'var(--fg-muted)'} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.9" />
            {m.label && (
              <text x={xPx(m.value)} y={padT - 4} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)"
                fill={m.color || 'var(--fg-muted)'} style={{ letterSpacing: '0.04em' }}>{m.label}</text>
            )}
          </g>
        ))}
        {/* hover crosshair */}
        {hover != null && (
          <line x1={(xPx(bins[hover].x0) + xPx(bins[hover].x1)) / 2} x2={(xPx(bins[hover].x0) + xPx(bins[hover].x1)) / 2}
            y1={padT} y2={padT + ih} stroke="var(--orange)" strokeWidth="1" opacity="0.7" />
        )}
        <ChartWatermark x={width - 20} y={padT + 16} />
      </svg>
      {hover != null && (() => {
        const b = bins[hover];
        const cx = (xPx(b.x0) + xPx(b.x1)) / 2;
        const share = (metric(b) / total) * 100;
        const rangeLabel = b._label ?? `${fmtEdge(b.x0)} – ${fmtEdge(b.x1)}`;
        // Allow legacy `valueFormatter` to override the SDK's `valueFormat`.
        const fmt = valueFormatter || valueFormat;
        return (
          <div className="chart-tooltip" style={{ left: Math.min(cx + 12, width - 180), top: 10 }}>
            <div className="t-date">{rangeLabel}</div>
            <div className="t-row"><span className="t-label">{countLabel}</span><span>{b.count}</span></div>
            {weighted && (
              <div className="t-row"><span className="t-label">{valueLabel || yLabel || 'Value'}</span><span>{fmt(b.weight, 2)}</span></div>
            )}
            <div className="t-row"><span className="t-label">Share</span><span>{share.toFixed(1)}%</span></div>
          </div>
        );
      })()}
    </div>
  );
}

// ── HealthFactorHistogram ────────────────────────────────
//
// SDK preset wrapper over Histogram for HF distributions. Two modes:
//   mode='usd'   bar height = Σ debtUsd in that HF bin (dollars at risk)
//   mode='count' bar height = number of positions in that HF bin
//
// Baked-in markers at HF=1 ("Liquidation") and HF=1.5 ("buffer"), colour
// bands red < 1 / yellow 1–1.5 / green ≥ 1.5, axis labels. Drops the manual
// legend hack the Risk page used to build — those are now properties of the
// chart itself.
//
// Input: `positions: [{ hf: number, debtUsd?: number }]`.
function HealthFactorHistogram({
  positions = [], mode = 'usd', width = 480, height = 220, binCount = 24,
  clampRange = [0, 3], showThreshold = true, markers, colorBands,
}) {
  const weighted = mode === 'usd';
  const values = positions.map(p => p.hf);
  const weight = weighted ? positions.map(p => p.debtUsd ?? 0) : undefined;

  const defaultMarkers = [{ value: 1.0, label: 'Liquidation', color: 'var(--red)' }];
  if (showThreshold) defaultMarkers.push({ value: 1.5, label: '1.5', color: 'var(--yellow)' });

  const defaultBands = [
    { from: 0, to: 1.0, color: 'var(--red)' },
    { from: 1.0, to: 1.5, color: 'var(--yellow)' },
    { from: 1.5, to: Infinity, color: 'var(--green)' },
  ];

  return (
    <Histogram
      values={values}
      weight={weight}
      binCount={binCount}
      clampRange={clampRange}
      width={width}
      height={height}
      color="var(--chart-1)"
      valueFormat={weighted ? fmtUSD : ((n) => fmtNum(n, 0))}
      markers={markers || defaultMarkers}
      colorBands={colorBands || defaultBands}
      xLabel="Health Factor"
      yLabel={weighted ? 'Debt at risk' : 'Positions'}
    />
  );
}

// ── DataTable ────────────────────────────────────────────
//
// Required by §6 of the Lending Analysis Standard:
//   "numeric columns use mono/tabular figures for vertical alignment;
//    label columns use the display face; thin top/bottom rule, no vertical
//    lines; sortable; horizontally scrollable on mobile."
//
// columns: [{
//   id, label, align?: 'left'|'right'|'center', numeric?: bool,
//   sortable?: bool, accessor?: (row) => sortable-value,
//   render?: (row, idx) => ReactNode,
//   width?: string,
// }]
// rows: any[]
// initialSort: { id, dir: 'asc'|'desc' }
// emptyMessage: shown when rows is empty
// maxHeight: when set, the body scrolls vertically with a sticky header
function DataTable({ columns, rows, initialSort = null, emptyMessage = 'No rows.', maxHeight = null }) {
  const [sort, setSort] = useState(initialSort);

  // Apply sort if a sortable column was clicked.
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.id === sort.id);
    if (!col) return rows;
    const acc = col.accessor || ((r) => r[col.id]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = acc(a), bv = acc(b);
      // null / undefined sort to bottom regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, columns]);

  const toggleSort = (col) => {
    if (col.sortable === false) return;
    if (!sort || sort.id !== col.id) setSort({ id: col.id, dir: col.numeric ? 'desc' : 'asc' });
    else setSort({ id: col.id, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
  };

  const inner = (
    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={maxHeight ? { position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 } : undefined}>
        <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          {columns.map(col => {
            const align = col.align || (col.numeric ? 'right' : 'left');
            const isActive = sort && sort.id === col.id;
            const arrow = !isActive ? '' : sort.dir === 'asc' ? ' ↑' : ' ↓';
            return (
              <th key={col.id}
                style={{
                  padding: '10px 12px', textAlign: align,
                  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                  color: 'var(--fg-muted)', fontWeight: 600, textTransform: 'uppercase',
                  cursor: col.sortable === false ? 'default' : 'pointer',
                  userSelect: 'none',
                  width: col.width,
                  whiteSpace: 'nowrap',
                }}
                onClick={() => toggleSort(col)}
                title={col.sortable === false ? '' : 'Click to sort'}
              >
                {col.label}{arrow}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedRows.length === 0 && (
          <tr>
            <td colSpan={columns.length} style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {emptyMessage}
            </td>
          </tr>
        )}
        {sortedRows.map((row, idx) => (
          <tr key={row.__id ?? idx}
            style={{ borderBottom: idx === sortedRows.length - 1 ? '1px solid var(--border)' : '1px solid var(--border-soft)' }}>
            {columns.map(col => {
              const align = col.align || (col.numeric ? 'right' : 'left');
              const value = col.render ? col.render(row, idx) : row[col.id];
              const fontFamily = col.numeric ? 'var(--font-mono)' : 'inherit';
              const fontVariantNumeric = col.numeric ? 'tabular-nums' : 'normal';
              return (
                <td key={col.id}
                  style={{
                    padding: '10px 12px', textAlign: align,
                    fontFamily, fontVariantNumeric,
                    fontSize: 13, color: 'var(--fg)',
                    whiteSpace: col.wrap ? 'normal' : 'nowrap',
                  }}>
                  {value == null ? '—' : value}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div style={{ overflowX: 'auto', overflowY: maxHeight ? 'auto' : 'visible', maxHeight: maxHeight || undefined }}>
      {inner}
    </div>
  );
}

Object.assign(window, { AreaChart, StackedBarChart, Treemap, Sparkline, Leaderboard, Heatmap, Candlestick, Histogram, HealthFactorHistogram, DataTable });
