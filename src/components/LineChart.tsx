"use client";
import { useMemo, useRef, useState } from "react";

export interface Point { x: string; y: number; label: string; hollow?: boolean }

/**
 * Single-series line chart: 2px line, ≥8px markers, recessive grid, crosshair + tooltip on hover,
 * keyboard-accessible points, and a table view for screen readers / exact values.
 */
export function LineChart({ points, yMax, yLabel, unit = "number", title }: { points: Point[]; yMax: number; yLabel: string; unit?: "pct" | "decimal" | "number"; title: string }) {
  const format = (v: number) => (unit === "pct" ? `${v.toFixed(0)}%` : unit === "decimal" ? v.toFixed(1) : v.toFixed(0));
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const W = 640, H = 220, L = 40, R = 14, T = 14, B = 28;
  const xs = useMemo(() => points.map((_, i) => (points.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (points.length - 1))), [points]);
  const y = (v: number) => T + (H - T - B) * (1 - Math.max(0, Math.min(yMax, v)) / yMax);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const path = points.map((p, i) => `${i ? "L" : "M"}${xs[i]},${y(p.y)}`).join(" ");
  const area = points.length > 1 ? `${path} L${xs[xs.length - 1]},${y(0)} L${xs[0]},${y(0)} Z` : "";

  function onMove(e: React.PointerEvent) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i; });
    setHover(best);
  }
  if (!points.length) return <p className="small muted">No data yet.</p>;
  return (
    <div>
      <div className="row between" style={{ marginBottom: 6 }}>
        <span className="label">{yLabel}</span>
        <button type="button" className="linkish tiny" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Show chart" : "Show table"}</button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="t"><caption className="sr-only">{title}</caption><thead><tr><th>When</th><th>Value</th><th>Detail</th></tr></thead>
            <tbody>{points.map((p, i) => <tr key={i}><td>{p.x}</td><td className="mono">{format(p.y)}</td><td>{p.label}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="chart" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
                <text className="axis-text" x={L - 6} y={y(t) + 3} textAnchor="end">{format(t)}</text>
              </g>
            ))}
            {area && <path className="area" d={area} />}
            <path className="series" d={path} />
            {hover !== null && <line className="crosshair" x1={xs[hover]} x2={xs[hover]} y1={T} y2={H - B} />}
            {points.map((p, i) => (
              <circle key={i} className={`pt${p.hollow ? " hollow" : ""}`} cx={xs[i]} cy={y(p.y)} r={hover === i ? 6 : 4.5} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${p.x}: ${format(p.y)}. ${p.label}`} />
            ))}
            <text className="axis-text" x={L} y={H - 8}>{points[0].x}</text>
            {points.length > 1 && <text className="axis-text" x={W - R} y={H - 8} textAnchor="end">{points[points.length - 1].x}</text>}
          </svg>
          {hover !== null && (
            <div className="tooltip" style={{ left: `${(xs[hover] / W) * 100}%`, top: `${(y(points[hover].y) / H) * 100}%` }}>
              <strong>{format(points[hover].y)}</strong> · {points[hover].x}
              <div style={{ opacity: 0.85 }}>{points[hover].label}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
