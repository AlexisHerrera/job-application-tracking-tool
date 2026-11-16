import { localDay } from "@/lib/format";
import { type Process } from "@/api/dashboard";
import { addDays, daysBetween, weekday } from "@/lib/days";

export interface TimelineScale {
  start: string;
  end: string;
  span: number;
  /** A day's left edge as a CSS percentage (its middle with `mid`). */
  x: (d: string, mid?: boolean) => string;
  /** The width of days `a` through `b` as a CSS percentage. */
  width: (a: string, b: string) => string;
  mondays: string[];
}

/** From the first application to two days past today (or the last interview, if later). At least
 * one process needs an `applied_at`. */
export function timelineScale(processes: Process[], today: string): TimelineScale {
  const dated = processes.filter((p) => p.applied_at);
  const start = dated.map((p) => localDay(p.applied_at!)).sort()[0];
  const lastIv = processes.flatMap((p) => p.interviews.map((i) => localDay(i.at))).sort().at(-1) ?? today;
  const end = addDays(lastIv > today ? lastIv : today, 2);
  const span = daysBetween(start, end) + 1;
  const x = (d: string, mid = false) => `${((daysBetween(start, d) + (mid ? 0.5 : 0)) / span) * 100}%`;
  const width = (a: string, b: string) => `${((daysBetween(a, b) + 1) / span) * 100}%`;
  const mondays = Array.from({ length: span }, (_, i) => addDays(start, i)).filter((d) => weekday(d) === 0);
  return { start, end, span, x, width, mondays };
}
