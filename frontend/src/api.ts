// Typed client for the FastAPI backend (same origin). In prod every call carries the Cognito ID
// token (auth.ts); locally there's no login.
import { idToken, onAuthorized, onUnauthorized } from "./auth";

export type Status =
  | "applied" | "screening" | "interviewing" | "on_hold" | "offer" | "rejected" | "withdrawn" | "ghosted";
export const STAGES = ["applied", "screening", "interviewing", "on_hold", "offer", "rejected", "withdrawn"] as const;
export type Stage = (typeof STAGES)[number];

export interface Application {
  id: string;
  company_id: string;
  company: string;
  role_title: string;
  job_url: string | null;
  job_description: string | null;
  source_ats: string | null;
  source_channel: string | null;
  seniority: string | null;
  stack: string[];
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  benefits: string | null;
  applied_at: string | null;
  current_stage: Stage;
  status: Status;
  current_round: number | null;
  max_stage_reached: Stage;
  last_event_at: string | null;
  next_interview_at: string | null;
  origin: "manual" | "email" | "import";
  needs_review: boolean;
  notes: string | null;
}

export interface TimelineEvent {
  id: string;
  application_id: string | null;
  kind: "email" | "manual";
  event_type: string;
  occurred_at: string;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  stage_implied: Stage | null;
  round: number | null;
  interview_at: string | null;
  needs_reply: boolean;
  replied_at: string | null;
  summary: string | null;
  confidence: number | null;
  extracted_company: string | null;
  extracted_role: string | null;
  match_method: string;
  company_hint?: string | null;
}

export interface Interview {
  id: string;
  application_id: string | null;
  company: string | null;
  role?: string | null;
  source: "calendar" | "email" | "manual";
  status: "scheduled" | "cancelled";
  starts_at: string;
  ends_at: string | null;
  title: string | null;
  round: number | null;
  interview_type: string | null;
  location: string | null;
  meeting_url: string | null;
  organizer: string | null;
  attendees: string[];
  html_link: string | null;
  match_method: string;
  general: boolean; // a recruiter/agency talk about roles: no application, notes inline
  notes: string | null;
  notes_count: number;
}

export interface Note {
  id: string;
  interview_id: string | null;
  body: string | null;
  round: number | null;
  interview_at: string | null;
  interview_type: string | null;
  interviewers: string | null;
  questions: string[];
  self_rating: number | null;
  went_well: string | null;
  went_wrong: string | null;
  topics_to_study: string[];
}

export type StepKind = "interview" | "take_home" | "other";

/** One expected step of the process, as the recruiter described it. */
export interface ProcessStep {
  id: string;
  position: number;
  name: string;
  kind: StepKind;
  optional: boolean;
  link: "auto" | "manual"; // manual + interview_id null = "hasn't happened yet"
  interview_id: string | null;
  done_at: string | null;
}

/** The process timeline, built by the API from the plan, the interviews and the outcome. */
export interface ProcessNode {
  kind: "applied" | "step" | "interview" | "outcome";
  label: string;
  state: "done" | "scheduled" | "next" | "planned" | "skipped" | "not_reached" | "outcome";
  at: string | null;
  step_id: string | null;
  interview_id: string | null;
  step_kind: StepKind | null;
  optional: boolean;
  implied: boolean; // done without a date: a later step already happened
  outcome: "rejected" | "withdrawn" | "offer" | "ghosted" | "on_hold" | null;
}

export interface InterviewDetail extends Interview {
  role: string | null;
  notes_list: Note[];
}

export interface NoteDetail extends Note {
  application_id: string;
  company: string | null;
  role: string | null;
}

export interface ApplicationDetail extends Application {
  events: TimelineEvent[];
  interviews: Interview[];
  interview_notes: Note[];
  steps: ProcessStep[];
  timeline: ProcessNode[];
  aliases: { kind: string; value: string; learned_from: string }[];
}

export interface CampaignSummary {
  id: string;
  name: string;
  started_on: string;
  ended_on: string | null;
  ongoing: boolean;
  notes: string | null;
  day: number;
  applications: number;
  per_week: number;
  first_response_on: string | null;
  first_interview_on: string | null;
  days_to_first_interview: number | null;
}

export interface Dashboard {
  upcoming_interviews: Interview[];
  recent_interviews: Interview[];
  unassigned_interviews: number;
  follow_ups: {
    needs_reply: { event_id: string; application_id: string | null; company: string | null; subject: string; received_at: string }[];
    no_news: { application_id: string; company: string; role: string; last_event_at: string | null }[];
  };
  needs_review: number;
  unassigned: number;
  campaign: CampaignSummary | null;
}

export interface FlowData {
  nodes: { id: string; label: string; count: number }[];
  links: { source: string; target: string; value: number }[];
  /** Each application's walk through the chart, by application id. */
  paths: Record<string, string[]>;
}

export interface Stats {
  total: number;
  by_status: Record<string, number>;
  funnel: { stage: Stage; count: number; pct: number }[];
  time_to_first_response: { count: number; median_days: number | null; mean_days: number | null };
  flow: FlowData;
  interviews: { done: number; upcoming: number };
}

export type InterviewOutcome = "advanced" | "rejected" | "withdrew" | "no_answer" | "waiting";

export interface TypedInterview {
  id: string;
  company: string;
  role: string;
  at: string;
  title: string | null;
  round: number | null;
  interview_type: string | null;
  /** The type read from the title when none is set. */
  guessed: string | null;
  outcome: InterviewOutcome;
  rating: number | null;
}

export interface TypeRow extends Record<InterviewOutcome, number> {
  type: string; // an interview type, or "not_set"
  done: number;
  rated: number;
  rating_advanced: number | null;
  rating_not: number | null;
  interviews: TypedInterview[];
}

export interface Insights {
  interview_types: TypeRow[];
}

export interface ActivityInterview {
  id: string;
  at: string;
  title: string | null;
  interview_type: string | null;
  round: number | null;
  upcoming: boolean;
}

export type ActivityItem =
  | ({ kind: "interview"; application_id: string; company: string; role: string; interview_id: string } & ActivityInterview)
  | ({ kind: "talk"; interview_id: string; organizer: string | null; attendees: string[] } & ActivityInterview)
  | { kind: "applied" | "reply" | "rejected" | "withdrawn" | "offer"; application_id: string; company: string; role: string; at: string };

export interface Process {
  application_id: string;
  company: string;
  role: string;
  status: Status;
  applied_at: string | null;
  reply_at: string | null;
  ended_at: string | null;
  last_event_at: string | null;
  days: number | null;
  quiet_days: number | null;
  interviews: (ActivityInterview & { outcome: InterviewOutcome | null })[];
}

export interface CalendarSyncResult {
  seen: number;
  created: number;
  updated: number;
  cancelled: number;
  unassigned: number;
  full_sync: boolean;
}

export type InterviewInput = Partial<Pick<Interview, "starts_at" | "ends_at" | "title" | "round" | "interview_type" | "location" | "notes">>;

export interface ScanResult {
  seen: number;
  job: number;
  created: number;
  unassigned: number;
  errors: number;
  started_fresh: boolean;
  llm_calls: number;
  running?: boolean; // AWS: we stopped waiting, the ingest run goes on and its results show up later
}

export type ChangeKind = "fill" | "change" | "append";

export interface FieldChange {
  field: string;
  label: string;
  current: unknown;
  proposed: unknown;
  kind: ChangeKind;
}

export interface PasteOption {
  application_id: string | null; // null = create new
  label: string;
  score: number;
  changes: FieldChange[];
  stage_change: { current: Stage | null; proposed: Stage; at: string | null; kind: "fill" | "change" } | null;
}

export interface PasteRecord {
  company: string | null; // null: the text doesn't name the hiring company (e.g. an agency post)
  evidence: string;
  salary_note: string | null;
  options: PasteOption[];
  default_option: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Job discovery (plan §20)
export type Verdict = "match" | "maybe" | "no";
export type PostingStatus = "new" | "interested" | "dismissed" | "applied";

export interface Posting {
  id: string;
  source: "jsearch" | "remoteyeah";
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
  status: PostingStatus;
  application_id: string | null;
  in_tracker: boolean;
}

export interface DiscoveryRules {
  seniority_exclude: string[];
  title_exclude: string[];
  agencies: string[];
  consultancies: string[];
  location_allow: string[];
  max_age_days: number;
  salary_floor_usd: number | null;
  jsearch_monthly_cap: number;
}

export interface DiscoverySearch {
  id: string;
  source: "jsearch" | "remoteyeah";
  label: string;
  params: Record<string, string | number | boolean>;
  enabled: boolean;
}

export interface DiscoveryRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  jsearch_requests: number;
  fetched: number;
  new: number;
  dropped: number;
  llm_calls: number;
  errors: number;
  notes: string[];
}

export interface DiscoveryState {
  criteria: string;
  rules: DiscoveryRules;
  searches: DiscoverySearch[];
  last_run: DiscoveryRun | null;
  jsearch_used_this_month: number;
  jsearch_configured: boolean;
  llm_configured: boolean;
  can_run: boolean;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  if (method !== "GET" && method !== "HEAD") {
    // CloudFront OAC signs requests to the Lambda Function URL, and Lambda doesn't accept unsigned
    // payloads: every write carries the SHA-256 of its body (of "" when there is none).
    headers["x-amz-content-sha256"] = await sha256Hex(payload ?? "");
  }
  const token = await idToken();
  if (token) headers["X-Id-Token"] = token;
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: "same-origin" });
  // Prod only (both are no-ops locally): a 401 means the session ran out, so sign in again.
  if (res.status === 401 && (await onUnauthorized())) return new Promise<T>(() => {}); // leaving for the login page
  if (res.ok) onAuthorized();
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export type ApplicationInput = Partial<Omit<Application, "id" | "status">> & {
  company: string;
  role_title: string;
  company_domain?: string;
  stage?: Stage | null;
  stage_at?: string | null;
  process_steps?: StepInput[];
};

export type StepInput = { name: string; kind?: StepKind | null; optional?: boolean };

export const api = {
  dashboard: () => request<Dashboard>("GET", "/dashboard"),
  stats: (campaign: string) => request<Stats>("GET", `/stats?${new URLSearchParams({ campaign })}`),
  insights: (campaign: string) => request<Insights>("GET", `/insights?${new URLSearchParams({ campaign })}`),
  activity: (campaign: string) =>
    request<{ items: ActivityItem[]; processes: Process[] }>("GET", `/activity?${new URLSearchParams({ campaign })}`),
  applications: (params: Record<string, string> = {}) =>
    request<Application[]>("GET", `/applications?${new URLSearchParams(params)}`),
  application: (id: string) => request<ApplicationDetail>("GET", `/applications/${id}`),
  createApplication: (data: ApplicationInput) => request<Application>("POST", "/applications", data),
  paste: (text: string, applicationId?: string) =>
    request<{ records: PasteRecord[]; llm_input_tokens: number; llm_output_tokens: number }>("POST", "/paste", {
      text,
      application_id: applicationId ?? null,
    }),
  updateApplication: (id: string, data: Partial<Application> & { company_domain?: string; process_steps?: StepInput[] }) =>
    request<Application>("PATCH", `/applications/${id}`, data),
  deleteApplication: (id: string) => request<void>("DELETE", `/applications/${id}`),
  changeStage: (id: string, data: { stage: Stage; at?: string; round?: number | null; note?: string }) =>
    request<Application>("POST", `/applications/${id}/stage`, data),
  markReviewed: (id: string) => request<Application>("POST", `/applications/${id}/reviewed`, {}),
  importCsv: (csv: string) =>
    request<{ created: number; matched_from_inbox: number }>("POST", "/applications/import", { csv }),
  campaigns: () => request<{ current_id: string | null; campaigns: CampaignSummary[] }>("GET", "/campaigns"),
  createCampaign: (data: { name: string; started_on: string; ended_on?: string | null; notes?: string | null }) =>
    request<CampaignSummary>("POST", "/campaigns", data),
  updateCampaign: (id: string, data: Partial<Pick<CampaignSummary, "name" | "started_on" | "ended_on" | "notes">>) =>
    request<CampaignSummary>("PATCH", `/campaigns/${id}`, data),
  deleteCampaign: (id: string) => request<void>("DELETE", `/campaigns/${id}`),
  inbox: () => request<TimelineEvent[]>("GET", "/inbox"),
  assign: (eventId: string, applicationId: string) =>
    request<TimelineEvent>("POST", `/events/${eventId}/assign`, { application_id: applicationId }),
  dismiss: (eventId: string) => request<TimelineEvent>("POST", `/events/${eventId}/dismiss`, {}),
  scanStatus: () => request<{ available: boolean; last_scan_at: string | null }>("GET", "/scan"),
  scan: () => request<ScanResult>("POST", "/scan", {}),
  markReplied: (eventId: string) => request<TimelineEvent>("POST", `/events/${eventId}/replied`, {}),
  createFromEvent: (eventId: string, data: ApplicationInput) =>
    request<Application>("POST", `/events/${eventId}/create-application`, data),
  note: (noteId: string) => request<NoteDetail>("GET", `/notes/${noteId}`),
  addNote: (appId: string, data: Partial<Note>) => request<Note>("POST", `/applications/${appId}/notes`, data),
  updateNote: (noteId: string, data: Partial<Note>) => request<Note>("PUT", `/notes/${noteId}`, data),
  deleteNote: (noteId: string) => request<void>("DELETE", `/notes/${noteId}`),
  addInterview: (appId: string, data: InterviewInput) => request<Interview>("POST", `/applications/${appId}/interviews`, data),
  updateInterview: (id: string, data: InterviewInput) => request<Interview>("PATCH", `/interviews/${id}`, data),
  interview: (id: string) => request<InterviewDetail>("GET", `/interviews/${id}`),
  addSteps: (appId: string, steps: StepInput[]) =>
    request<ProcessStep[]>("POST", `/applications/${appId}/steps`, { steps }),
  updateStep: (
    id: string,
    data: Partial<Pick<ProcessStep, "name" | "kind" | "optional" | "interview_id" | "done_at" | "position">> & { link?: "auto" },
  ) => request<ProcessStep>("PATCH", `/steps/${id}`, data),
  deleteStep: (id: string) => request<void>("DELETE", `/steps/${id}`),
  removeInterview: (id: string) => request<void>("DELETE", `/interviews/${id}`),
  assignInterview: (id: string, applicationId: string) =>
    request<Interview>("POST", `/interviews/${id}/assign`, { application_id: applicationId }),
  unassignedInterviews: () => request<Interview[]>("GET", "/interviews/unassigned"),
  interviews: () => request<Interview[]>("GET", "/interviews"),
  markGeneral: (id: string) => request<Interview>("POST", `/interviews/${id}/general`, {}),
  calendarStatus: () => request<{ connected: boolean; calendar_id: string; last_sync_at: string | null }>("GET", "/calendar"),
  syncCalendar: () => request<CalendarSyncResult>("POST", "/calendar/sync", {}),
  postings: (params: Record<string, string> = {}) =>
    request<{ postings: Posting[]; counts: { total: number; hidden: number; unscored: number } }>(
      "GET",
      `/discover?${new URLSearchParams(params)}`,
    ),
  setPostingStatus: (id: string, status: PostingStatus) =>
    request<{ id: string; status: PostingStatus }>("PATCH", `/discover/${id}`, { status }),
  applyPosting: (id: string) => request<{ posting_id: string; application: Application }>("POST", `/discover/${id}/apply`, {}),
  discoverySettings: () => request<DiscoveryState>("GET", "/discover/settings"),
  saveDiscoverySettings: (data: { criteria?: string; rules?: Partial<DiscoveryRules> }) =>
    request<DiscoveryState>("PUT", "/discover/settings", data),
  seedDiscovery: () => request<DiscoveryState>("POST", "/discover/seed", {}),
  addSearch: (data: Omit<DiscoverySearch, "id">) => request<DiscoverySearch>("POST", "/discover/searches", data),
  updateSearch: (id: string, data: Partial<Omit<DiscoverySearch, "id" | "source">>) =>
    request<DiscoverySearch>("PATCH", `/discover/searches/${id}`, data),
  deleteSearch: (id: string) => request<void>("DELETE", `/discover/searches/${id}`),
  runDiscovery: (rescore = false) => request<DiscoveryRun>("POST", "/discover/run", { rescore }),
};

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

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
