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
