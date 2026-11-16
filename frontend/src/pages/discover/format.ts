import type { Posting } from "@/api/discovery";

export const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

export function salaryOf(p: Posting): string | null {
  if (p.salary_text) return p.salary_text;
  if (!p.salary_min && !p.salary_max) return null;
  const n = (v: number) => new Intl.NumberFormat("en-US").format(v);
  const lo = p.salary_min ?? p.salary_max!;
  const hi = p.salary_max ?? p.salary_min!;
  return `${lo === hi ? n(lo) : `${n(lo)}–${n(hi)}`}${p.salary_period ? ` / ${p.salary_period.toLowerCase()}` : ""}`;
}

export function usdSalary(p: Posting): string | null {
  if (!p.salary_usd_max) return null;
  const k = (v: number) => `${Math.round(v / 1000)}k`;
  const lo = p.salary_usd_min ?? p.salary_usd_max;
  return `≈ USD ${lo === p.salary_usd_max ? k(lo) : `${k(lo)}–${k(p.salary_usd_max)}`} / yr`;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** "about 40s left", from how long the finished units took. */
export function eta(elapsed: number | null | undefined, done: number, total: number): string | null {
  if (!elapsed || done < 1 || done >= total) return null;
  const left = (elapsed / done) * (total - done);
  return left < 10 ? "a few seconds left" : `about ${duration(left)} left`;
}
