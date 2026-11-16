import { useState, type KeyboardEvent } from "react";
import { useWidth } from "@/lib/useWidth";
import { longDay, shortDay } from "@/pages/discover-insights/format";
import type { Series } from "@/pages/discover-insights/constants";
import { barWidth, stack, ticks, topRounded } from "./geometry";
import { DayTooltip } from "./DayTooltip";

const PLOT = 150;
const M = { top: 18, right: 4, bottom: 22, left: 34 };
const HEIGHT = M.top + PLOT + M.bottom;
const TIP = 176; // the tooltip's width (w-44)

/** Right of the day's column, or left of it when there's no room on the right. */
const tipLeft = (x: number, slot: number, width: number) => (x + slot + 8 + TIP > width ? Math.max(0, x - 8 - TIP) : x + slot + 8);

/** One stacked column per day, bottom series first. Hovering or focusing a day shows every
 * series' value; the arrow keys move between days. The tallest column carries its total. */
export function DayColumns<K extends string>({ days, rows, series, noun }: { days: string[]; rows: Record<K, number>[]; series: Series<K>[]; noun: string }) {
  const [ref, measured] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const width = Math.max(measured, 280);
  const totals = rows.map((r) => series.reduce((n, s) => n + r[s.key], 0));
  const axis = ticks(Math.max(...totals));
  const yMax = axis[axis.length - 1];
  const plotW = width - M.left - M.right;
  const slot = plotW / days.length;
  const bar = barWidth(slot);
  const base = M.top + PLOT;
  const scale = PLOT / yMax;
  const peak = totals.indexOf(Math.max(...totals));
  const every = Math.ceil(days.length / Math.max(2, Math.floor(plotW / 64)));
  const color = Object.fromEntries(series.map((s) => [s.key, s.color]));

  const onKey = (e: KeyboardEvent) => {
    const last = days.length - 1;
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step) setActive((i) => Math.min(last, Math.max(0, (i ?? last) + step)));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else return;
    e.preventDefault();
  };

  const sum = totals.reduce((a, b) => a + b, 0);
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        tabIndex={0}
        aria-label={`${sum.toLocaleString()} ${noun} over ${days.length} days, from ${shortDay(days[0])} to ${shortDay(days[days.length - 1])}. Use the arrow keys to read each day, or the table view.`}
        onKeyDown={onKey}
        onFocus={() => setActive((i) => i ?? days.length - 1)}
        onBlur={() => setActive(null)}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {axis.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={base - t * scale} y2={base - t * scale} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
            <text x={M.left - 6} y={base - t * scale} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{t.toLocaleString()}</text>
          </g>
        ))}
        {active !== null && <rect x={M.left + active * slot} y={M.top - 6} width={slot} height={PLOT + 6} rx={3} fill="var(--muted)" />}
        {rows.map((r, i) => {
          const x = M.left + i * slot + (slot - bar) / 2;
          const segs = stack(series.map((s) => ({ key: s.key, value: r[s.key] })), base, scale);
          return (
            <g key={days[i]}>
              {segs.map((s) => (s.top ? <path key={s.key} d={topRounded(x, s.y, bar, s.h)} fill={color[s.key]} /> : <rect key={s.key} x={x} y={s.y} width={bar} height={s.h} fill={color[s.key]} />))}
              {i === peak && totals[i] > 0 && <text x={x + bar / 2} y={base - totals[i] * scale - 5} textAnchor="middle" className="fill-foreground text-[10px] font-medium tabular-nums">{totals[i].toLocaleString()}</text>}
              {(days.length - 1 - i) % every === 0 && <text x={M.left + i * slot + slot / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{shortDay(days[i])}</text>}
              <rect x={M.left + i * slot} y={M.top - 6} width={slot} height={PLOT + 6} fill="transparent" onMouseEnter={() => setActive(i)} />
            </g>
          );
        })}
      </svg>
      {active !== null && (
        <DayTooltip
          title={longDay(days[active])}
          rows={[...series].reverse().map((s) => ({ label: s.label, color: s.color, value: rows[active][s.key] }))}
          total={totals[active]}
          left={tipLeft(M.left + active * slot, slot, width)}
        />
      )}
    </div>
  );
}
