import type { View } from "./query";

export const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "match", label: "Matches" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
  { value: "unscored", label: "Not scored" },
  { value: "hidden", label: "Hidden" },
];

export const PAGE_SIZE = 50;
// URL param → API param. The filters live in the URL, so they survive opening an application
// and coming back.
export const FILTER_PARAMS: Record<string, string> = {
  source: "source",
  q: "q",
  loc: "location",
  pub: "publisher",
  sen: "seniority",
  size: "company_size",
  sector: "sector",
  mode: "work_mode",
  fit: "location_fit",
  emp: "employer_kind",
  tech: "tech",
  salary: "salary_min",
  posted: "posted_days",
};

export const SENIORITY: Record<string, string> = { junior: "Junior", mid: "Mid", semi_senior: "Semi senior", senior: "Senior", staff_plus: "Staff+", unclear: "Unclear" };
export const COMPANY_SIZE: Record<string, string> = {
  startup: "Startup (<50)",
  small: "Small (50–250)",
  medium: "Medium (250–1k)",
  large: "Large (1k+)",
  unclear: "Unclear",
};
export const SECTOR: Record<string, string> = {
  fintech: "Fintech",
  ai: "AI",
  security: "Security",
  devtools: "Dev tools",
  saas: "SaaS / business software",
  ecommerce: "E-commerce",
  health: "Health",
  education: "Education",
  crypto: "Crypto",
  media: "Media",
  gaming: "Gaming",
  logistics: "Logistics & travel",
  hr: "HR & recruiting",
  government: "Government & non-profit",
  consulting: "Consulting",
  other: "Other",
  unclear: "Unclear",
};
export const WORK_MODE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unclear: "Unclear" };
export const LOCATION_FIT: Record<string, string> = { yes: "Location fits", no: "Location doesn't fit", unclear: "Location unclear" };
export const EMPLOYER: Record<string, string> = { direct: "Hiring directly", agency: "Agency", consultancy: "Consultancy", unclear: "Unclear" };
export const POSTED = [
  { value: "", label: "Posted any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last week" },
  { value: "14", label: "Last 2 weeks" },
  { value: "30", label: "Last month" },
];

export const DROP_LABEL: Record<string, string> = {
  agency: "agency / marketplace",
  consultancy: "consultancy",
  location: "location",
  "location: brazil onsite": "onsite in Brazil",
  "language: portuguese": "in Portuguese",
  old: "too old",
  salary: "below the salary floor",
  duplicate: "duplicate",
};
