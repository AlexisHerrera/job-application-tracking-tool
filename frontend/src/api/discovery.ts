// Job discovery (plan §20, §21)
import type { CriteriaProfile } from "./discoverySettings";

export type SearchSource = "remoteyeah" | "getonbrd" | "workable";
/** "jsearch" only on postings stored before round 5, when it was a source. */
export type PostingSource = SearchSource | "ashby" | "greenhouse" | "lever" | "jsearch";
export type Verdict = "match" | "maybe" | "no";
export type PostingStatus = "new" | "interested" | "dismissed" | "applied";
/** Why a posting was discarded by hand (the backend's discovery.DISCARD_REASONS). */
export type DiscardReason =
  | "closed" | "no_apply" | "fake" | "duplicate"
  | "too_senior" | "too_junior" | "stack" | "role" | "language"
  | "location" | "work_mode" | "salary" | "contract"
  | "company" | "intermediary" | "other";
export interface Discard {
  reason: DiscardReason | null;
  note?: string;
}
export interface PostingStatusSaved {
  id: string;
  status: PostingStatus;
  discard_reason: DiscardReason | null;
  discard_note: string | null;
  reviewed_at: string | null;
}

export interface Posting {
  id: string;
  source: PostingSource;
  search_label: string | null;
  url: string;
  title: string;
  company: string;
  location: string | null;
  employment_type: string | null;
  salary_text: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: string | null;
  publisher: string | null;
  posted_at: string | null;
  fetched_at: string | null;
  description: string;
  drop_reason: string | null;
  verdict: Verdict | null;
  score: number | null;
  reasons: string[];
  location_fit: "yes" | "no" | "unclear" | null;
  seniority: string | null;
  years_required: number | null;
  employer_kind: string | null;
  ai_related: boolean;
  stack_overlap: string[];
  technologies: string[];
  work_mode: string | null;
  company_size: string | null;
  sector: string | null;
  salary_usd_min: number | null;
  salary_usd_max: number | null;
  status: PostingStatus;
  discard_reason: DiscardReason | null;
  discard_note: string | null;
  /** When it left the review queue (saved, applied or discarded); null while new. */
  reviewed_at: string | null;
  application_id: string | null;
  in_tracker: boolean;
}

/** Where the run or re-score started from the page is (GET /discover/progress). */
export interface DiscoveryProgress {
  running: boolean;
  kind?: "run" | "score" | "rescore";
  phase?: "collecting" | "scoring" | "done";
  elapsed_s?: number;
  phase_elapsed_s?: number | null;
  searches_total?: number;
  searches_done?: number;
  current?: string | null;
  fetched?: number;
  new?: number;
  hidden?: number;
  to_score?: number;
  scored?: number;
  errors?: number;
}

/** [value, how many postings in the view have it], most common first. */
export type Facet = [string, number][];

export interface PostingPage {
  postings: Posting[];
  total: number;
  counts: { total: number; hidden: number; unscored: number };
  facets: {
    publisher: Facet;
    seniority: Facet;
    company_size: Facet;
    sector: Facet;
    work_mode: Facet;
    location_fit: Facet;
    employer_kind: Facet;
    technologies: Facet;
  };
}

export interface DiscoveryRules {
  seniority_exclude: string[];
  title_exclude: string[];
  role_exclude: string[];
  agencies: string[];
  consultancies: string[];
  location_allow: string[];
  blocked: string[];
  max_age_days: number;
  salary_floor_usd: number | null;
}

export interface DiscoverySearch {
  id: string;
  source: SearchSource;
  label: string;
  params: Record<string, string | number | boolean>;
  enabled: boolean;
  /** How the last fetch went, written by the runs. */
  last_fetched_at: string | null;
  /** The last fetch that brought any posting. */
  last_found_at: string | null;
  last_status: string | null; // "ok" | the error
  /** Postings the last fetch that worked brought. */
  last_count: number | null;
  /** Failed fetches in a row. */
  fail_streak: number;
}

/** What the page sends when it adds or edits a search. */
export type SearchInput = Pick<DiscoverySearch, "source" | "label" | "params" | "enabled">;

export interface DiscoveryRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  fetched: number;
  new: number;
  dropped: number;
  llm_calls: number;
  errors: number;
  notes: string[];
}

/** GET /discover/status: what the sidebar shows on every page. */
export interface DiscoveryStatus {
  /** Postings left to look at: the default review queue (let through by the rules, still new). */
  to_review: number;
  /** The newest run that wasn't a re-score. */
  last_run: DiscoveryRun | null;
}

/** In AWS a run starts in the discover Lambda and the request returns at once; the page then
 * follows the progress endpoint until it's done. */
export interface DiscoveryStarted {
  started: true;
}

/** The watchlist of company job boards (plan §21), in numbers. */
export interface WatchlistSummary {
  total: number;
  enabled: number;
  by_ats: { ashby: number; greenhouse: number; lever: number };
  last_scan_at: string | null; // the last `discover companies scan` of the board directory
  with_jobs: number;
  jobs_kept: number;
  last_checked_at: string | null;
}

export interface DiscoveryState {
  criteria: string;
  rules: DiscoveryRules;
  searches: DiscoverySearch[];
  companies: WatchlistSummary;
  last_run: DiscoveryRun | null;
  llm_configured: boolean;
  can_run: boolean;
  /** Visible new postings waiting for a score. */
  unscored: number;
  profile: CriteriaProfile;
  /** False until the fields are saved once: the AI still reads the old free text. */
  profile_saved: boolean;
  criteria_limit: number;
  /** What "Hide company" put on the block list, and when. */
  blocked_added: { name: string; at: string }[];
}
