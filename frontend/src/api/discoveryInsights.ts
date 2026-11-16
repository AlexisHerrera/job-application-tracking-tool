// The Insights page (GET /discover/insights): core/discovery_insights.py and discard_hints.py.
import type { DiscardReason, PostingSource, Verdict } from "./discovery";

/** [value, how many], most first. */
export type Tally<T = string> = [T, number][];

export interface PostingsDay {
  /** Nothing hid them: they reached the review queue. */
  queue: number;
  /** The rules, the dedupe or the AI's consultancy check hid them. */
  hidden: number;
}

export interface SourceDays extends PostingsDay {
  source: PostingSource;
  days: PostingsDay[];
}

export interface ReviewsDay {
  saved: number;
  applied: number;
  discarded: number;
}

export interface DiscardHint {
  text: string;
  /** The page with the knob: Criteria, its Rules tab, or Sources. */
  where: "criteria" | "rules" | "sources";
  /** The card or list there. */
  section: string;
}

export type DetailKind = "years" | "technologies" | "location" | "work_mode" | "salary" | "employment_type" | "employer_kind";

export interface DiscardReasonRow {
  reason: DiscardReason;
  count: number;
  /** "source": the posting itself (closed, fake, no way to apply, duplicate). */
  about: "criteria" | "source";
  splits: { source: Tally<PostingSource>; publisher: Tally; seniority: Tally; company: Tally };
  /** One more split where a field says the most (years asked, technologies…). Salary values
   * are 10k bands: 40 is USD 40–50k. */
  detail: { kind: DetailKind; values: Tally<string | number> } | null;
  verdicts: Record<Verdict | "unscored", number>;
  hints: DiscardHint[];
  notes: { note: string; title: string; company: string }[];
}

export interface SourceQuality {
  source: PostingSource;
  reviewed: number;
  /** Saved or applied to. */
  kept: number;
  discarded: number;
  closed: number;
  fake: number;
  no_apply: number;
  duplicate: number;
}

export interface DiscoveryInsights {
  /** The window's days ("YYYY-MM-DD", Buenos Aires), today last; the per-day arrays follow it. */
  days: string[];
  postings: PostingsDay & {
    total: number;
    days: PostingsDay[];
    sources: SourceDays[];
    /** Hide reasons, "title: <word>" grouped as "title". */
    hidden_by: Tally;
  };
  reviews: ReviewsDay & {
    total: number;
    days: ReviewsDay[];
    /** The review queue now. */
    waiting: number;
  };
  discards: {
    total: number;
    without_reason: number;
    reasons: DiscardReasonRow[];
    sources: SourceQuality[];
  };
}
