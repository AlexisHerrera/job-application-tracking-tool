import type { PostingSource } from "@/api/discovery";
import type { DetailKind, DiscardHint, PostingsDay, ReviewsDay } from "@/api/discoveryInsights";

export const WINDOWS = [7, 14, 30, 90] as const;
export const DEFAULT_WINDOW = 30;

/** One stacked series of a day chart, bottom first. Colors are index.css's --insight-* tokens. */
export interface Series<K extends string> {
  key: K;
  label: string;
  color: string;
}

export const POSTING_SERIES: Series<keyof PostingsDay>[] = [
  { key: "queue", label: "Reached the queue", color: "var(--insight-queue)" },
  { key: "hidden", label: "Hidden", color: "var(--insight-aside)" },
];

export const REVIEW_SERIES: Series<keyof ReviewsDay>[] = [
  { key: "applied", label: "Applied", color: "var(--insight-applied)" },
  { key: "saved", label: "Saved", color: "var(--insight-saved)" },
  { key: "discarded", label: "Discarded", color: "var(--insight-aside)" },
];

export const SOURCE_LABEL: Record<PostingSource, string> = {
  remoteyeah: "remoteyeah",
  getonbrd: "getonbrd",
  workable: "Workable",
  ashby: "Ashby boards",
  greenhouse: "Greenhouse boards",
  lever: "Lever boards",
  jsearch: "JSearch (gone)",
};

export const DETAIL_TITLE: Record<DetailKind, string> = {
  years: "Years asked",
  technologies: "Outside your stack",
  location: "Location",
  work_mode: "Work mode",
  salary: "Pays (a year)",
  employment_type: "Listed as",
  employer_kind: "The AI saw",
};

/** Where a hint's knob is. */
export const KNOB: Record<DiscardHint["where"], { page: string; to: string }> = {
  criteria: { page: "Criteria", to: "/discover/criteria" },
  rules: { page: "Rules", to: "/discover/criteria?tab=rules" },
  sources: { page: "Sources", to: "/discover/sources" },
};
