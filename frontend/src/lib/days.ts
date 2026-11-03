// Days are "YYYY-MM-DD" strings in the app's timezone; arithmetic goes through UTC midnights.
const DAY_MS = 86_400_000;
export const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
export const weekday = (d: string) => (new Date(utc(d)).getUTCDay() + 6) % 7; // Monday = 0
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY_MS);
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The calendar page's link for a day: `?day=`, plus `&month=` when it isn't this month. */
export function calendarDayLink(day: string, today: string): string {
  const p = new URLSearchParams({ day });
  if (!day.startsWith(today.slice(0, 7))) p.set("month", day.slice(0, 7));
  return `/calendar?${p}`;
}
