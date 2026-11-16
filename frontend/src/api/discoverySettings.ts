// The Discover Criteria and Sources pages (plan §21, round 6)
import type { DiscoveryRules, DiscoveryState } from "./discovery";

/** What the candidate is looking for, as fields; the server renders it to the criteria text. */
export interface CriteriaProfile {
  home: string;
  background: string;
  roles: string[];
  ai_roles: string[];
  seniority_ok: string[];
  seniority_maybe: string[];
  seniority_no: string[];
  max_years: number | null;
  stack: string[];
  stack_no: string[];
  location_yes: string[];
  location_maybe: string[];
  location_no: string[];
  location_notes: string;
  salary_min_usd: number | null;
  industries: string[];
  notes: string;
}

export type ProfileListKey = { [K in keyof CriteriaProfile]: CriteriaProfile[K] extends string[] ? K : never }[keyof CriteriaProfile];
export type RuleListKey = { [K in keyof DiscoveryRules]: DiscoveryRules[K] extends string[] ? K : never }[keyof DiscoveryRules];

export interface CriteriaPreview {
  text: string;
  chars: number;
  limit: number;
}

/** PUT /discover/settings: saving rules applies them to the stored postings. */
export interface SettingsSaved extends DiscoveryState {
  reapplied: { hidden: number; restored: number } | null;
}

export interface RuleListHits {
  total: number;
  entries: Record<string, number>;
}

/** How many stored postings each hide reason, list and entry accounts for. */
export interface RuleHits {
  reasons: Record<string, number>;
  lists: Record<RuleListKey, RuleListHits>;
}

export type Ats = "ashby" | "greenhouse" | "lever";
export type WatchStatus = "on" | "off" | "gone" | "error" | "with_roles" | "unread";
export type WatchSort = "name" | "roles" | "checked";

export interface WatchedCompany {
  id: string;
  ats: Ats;
  slug: string;
  name: string;
  enabled: boolean;
  note: string | null;
  created_at: string | null;
  last_checked_at: string | null;
  last_status: string | null; // "ok" | "gone" | the error
  jobs_total: number | null;
  jobs_kept: number | null;
  /** The last read that kept a role. */
  last_found_at: string | null;
  /** Failed reads in a row. */
  fail_streak: number;
  board_url: string | null;
}

export interface WatchlistPage {
  companies: WatchedCompany[];
  total: number;
  counts: Record<WatchStatus, number>;
}
