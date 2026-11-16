import { utc } from "@/lib/days";

// Days are "YYYY-MM-DD" calendar days (Buenos Aires), formatted without shifting them.
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const shortDay = (day: string) => SHORT.format(utc(day));
export const longDay = (day: string) => LONG.format(utc(day));

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "12%", or "<1%" for a share that rounds to nothing but isn't. */
export function pct(part: number, whole: number): string {
  if (!whole) return "—";
  const p = (100 * part) / whole;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}
