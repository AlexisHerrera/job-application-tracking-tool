// Geometry for the day column charts (the dataviz mark specs): columns at most 24px wide with
// air between them, a 2px surface gap between stacked segments, 4px rounded tops, square at the
// baseline, and a few round-number ticks.

export const GAP = 2;
export const RADIUS = 4;
export const MAX_BAR = 24;

/** Up to `most` ticks from 0 at a 1 / 2 / 5 step that covers `max`. */
export function ticks(max: number, most = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / most;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** How wide a column is in a slot: never the whole slot, never past MAX_BAR. */
export const barWidth = (slot: number) => Math.max(1, Math.min(MAX_BAR, slot * 0.68, slot - 1));

/** A rect with rounded top corners only (the data end of a column). */
export function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface Segment {
  key: string;
  y: number;
  h: number;
  top: boolean;
}

/** One column's segments, bottom up, `scale` pixels per unit from `base`. A segment above another
 * gives up GAP pixels to the surface gap, keeping at least 1px; the column's top stays exact. */
export function stack(values: { key: string; value: number }[], base: number, scale: number): Segment[] {
  const drawn = values.filter((v) => v.value > 0);
  const out: Segment[] = [];
  let y0 = base;
  drawn.forEach((v, i) => {
    const top = y0 - v.value * scale;
    const bottom = i === 0 ? y0 : y0 - GAP;
    const y = Math.min(top, bottom - 1);
    out.push({ key: v.key, y, h: bottom - y, top: i === drawn.length - 1 });
    y0 = top;
  });
  return out;
}
