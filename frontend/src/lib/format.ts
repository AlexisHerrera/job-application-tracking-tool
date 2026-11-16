import type { Application } from "@/api/applications";

const TZ = "America/Buenos_Aires";

export function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  // Plain dates (campaign days) are calendar days, not instants: don't shift them by timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso = `${iso}T12:00:00-03:00`;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(iso));
}

/** The calendar day (YYYY-MM-DD) an instant falls on, in the app's timezone. */
export function localDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function daysAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return daysAgo(iso);
}

export const label = (s: string) => s.replace(/_/g, " ");

/** Noon local time keeps a picked calendar day stable across timezones. */
export const dayToIso = (day: string) => `${day}T12:00:00-03:00`;
export const isoToDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }) : "";
/** <input type="datetime-local"> value in the app's timezone, and back (Buenos Aires has no DST). */
export const isoToDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: TZ, hour12: false }).slice(0, 16).replace(" ", "T") : "";
export const dateTimeToIso = (local: string) => `${local}:00-03:00`;

export function relativeDay(iso: string): string {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
  const diff = Math.round((new Date(day(new Date(iso))).getTime() - new Date(day(new Date())).getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function fmtSalary(a: Pick<Application, "salary_min" | "salary_max" | "salary_currency">): string | null {
  if (!a.salary_min && !a.salary_max) return null;
  const n = (v: number) => new Intl.NumberFormat("en-US").format(v);
  const range = a.salary_min && a.salary_max && a.salary_min !== a.salary_max
    ? `${n(a.salary_min)}–${n(a.salary_max)}`
    : n((a.salary_min || a.salary_max)!);
  return `${a.salary_currency ?? ""} ${range} / year`.trim();
}

/** "today", "3d", "2w", "4mo": how long ago, short enough for a card corner or a table cell. */
export function shortAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 7) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
