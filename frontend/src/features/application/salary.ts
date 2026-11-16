import type { Application } from "@/api/applications";

// Salary is stored yearly. This input formats as you type ("90000" shows "90,000"), accepts
// shorthand ("90k", "1.2m"), converts a monthly figure (×12), and says exactly what gets saved.

export const CURRENCIES = ["USD", "EUR", "GBP", "ARS", "BRL", "CAD", "MXN", "CLP", "COP", "UYU"];

export type SalaryDraft = { min: string; max: string; currency: string; period: "year" | "month" };

export const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

/** "90,000" → 90000, "90k" → 90000, "1.2m" → 1200000; null when empty, NaN when unreadable. */
export function parseAmount(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[\s,_$]/g, "");
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(t);
  if (!m) return NaN;
  return Math.round(Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1));
}

export function formatLive(raw: string): string {
  const t = raw.replace(/\s/g, "");
  if (/[km]$/i.test(t)) {
    const n = parseAmount(t);
    return n === null || Number.isNaN(n) ? raw : fmt(n);
  }
  if (t.includes(".")) return raw; // mid-way through "1.5k": leave it alone until the suffix
  const digits = t.replace(/\D/g, "");
  return digits ? fmt(Number(digits)) : "";
}

export function draftFrom(a?: Partial<Pick<Application, "salary_min" | "salary_max" | "salary_currency">>): SalaryDraft {
  const min = a?.salary_min ?? null, max = a?.salary_max ?? null;
  return {
    min: min != null ? fmt(min) : "",
    max: max != null && max !== min ? fmt(max) : "",
    currency: a?.salary_currency ?? "USD",
    period: "year",
  };
}

/** What will be saved (yearly), plus anything that looks wrong. */
export function readSalary(d: SalaryDraft) {
  const factor = d.period === "month" ? 12 : 1;
  let min = parseAmount(d.min), max = parseAmount(d.max);
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return { patch: null, error: "Use digits, optionally with k or m (90000, 90k).", hint: null, text: null };
  }
  if (min === null && max !== null) [min, max] = [max, null];
  if (min === null) {
    return { patch: { salary_min: null, salary_max: null, salary_currency: null }, error: null, hint: null, text: null };
  }
  const hi = max ?? min; // a single figure is stored as min = max
  if (hi < min) return { patch: null, error: "The first amount is higher than the second.", hint: null, text: null };
  const range = (a: number, b: number) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`);
  const cur = d.currency.toUpperCase();
  const yearly = range(min * factor, hi * factor);
  const text = d.period === "month"
    ? `${cur} ${range(min, hi)} a month → saved as ${cur} ${yearly} per year`
    : `Saved as ${cur} ${yearly} per year`;
  const hint = d.period === "year" && hi < 12_000
    ? "That's low for a yearly salary. Is it monthly? Switch to per month."
    : d.period === "month" && min > 50_000
      ? "That's high for a monthly salary. Is it yearly? Switch to per year."
      : null;
  return { patch: { salary_min: min * factor, salary_max: hi * factor, salary_currency: cur }, error: null, hint, text };
}
