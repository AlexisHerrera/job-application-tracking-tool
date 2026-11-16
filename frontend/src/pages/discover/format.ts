import type { Posting } from "@/api/discovery";

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
