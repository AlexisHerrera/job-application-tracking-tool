// Typed client for the FastAPI backend (same origin). In prod every call carries the Cognito ID
// token (auth.ts); locally there's no login.
import { idToken, onAuthorized, onUnauthorized } from "@/lib/auth";
import type {
  Application,
  ApplicationDetail,
  ApplicationInput,
  PasteRecord,
  ProcessStep,
  ScanResult,
  Stage,
  StepInput,
  TimelineEvent,
} from "./applications";
import type { CampaignSummary } from "./campaigns";
import type { ActivityItem, Dashboard, Insights, Process, Stats } from "./dashboard";
import type {
  DiscoveryProgress,
  DiscoveryRules,
  DiscoveryRun,
  DiscoverySearch,
  DiscoveryState,
  Discard,
  PostingPage,
  PostingStatus,
  PostingStatusSaved,
} from "./discovery";
import type { Ats, CriteriaPreview, CriteriaProfile, RuleHits, SettingsSaved, WatchedCompany, WatchlistPage } from "./discoverySettings";
import type { CalendarSyncResult, Interview, InterviewDetail, InterviewInput, Note, NoteDetail } from "./interviews";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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
  postings: (params: Record<string, string> = {}) => request<PostingPage>("GET", `/discover?${new URLSearchParams(params)}`),
  setPostingStatus: (id: string, status: PostingStatus, discard?: Discard) =>
    request<PostingStatusSaved>("PATCH", `/discover/${id}`, { status, discard_reason: discard?.reason ?? null, discard_note: discard?.note || null }),
  applyPosting: (id: string) => request<{ posting_id: string; application: Application }>("POST", `/discover/${id}/apply`, {}),
  discoverySettings: () => request<DiscoveryState>("GET", "/discover/settings"),
  saveDiscoverySettings: (data: { criteria?: string; profile?: CriteriaProfile; rules?: Partial<DiscoveryRules> }) =>
    request<SettingsSaved>("PUT", "/discover/settings", data),
  previewCriteria: (profile: CriteriaProfile) => request<CriteriaPreview>("POST", "/discover/criteria/preview", { profile }),
  ruleHits: () => request<RuleHits>("GET", "/discover/rules/hits"),
  discoveryRuns: (limit = 30) => request<DiscoveryRun[]>("GET", `/discover/runs?limit=${limit}`),
  watchlist: (params: Record<string, string>) => request<WatchlistPage>("GET", `/discover/companies?${new URLSearchParams(params)}`),
  watchCompany: (data: { ats: Ats; slug: string; name?: string }) => request<WatchedCompany>("POST", "/discover/companies", data),
  updateWatched: (id: string, data: { enabled?: boolean; name?: string }) => request<WatchedCompany>("PATCH", `/discover/companies/${id}`, data),
  seedDiscovery: () => request<DiscoveryState & { added: { searches: number; companies: number } }>("POST", "/discover/seed", {}),
  blockCompany: (company: string) => request<DiscoveryState & { hidden: number }>("POST", "/discover/block", { company }),
  addSearch: (data: Omit<DiscoverySearch, "id">) => request<DiscoverySearch>("POST", "/discover/searches", data),
  updateSearch: (id: string, data: Partial<Omit<DiscoverySearch, "id" | "source">>) =>
    request<DiscoverySearch>("PATCH", `/discover/searches/${id}`, data),
  deleteSearch: (id: string) => request<void>("DELETE", `/discover/searches/${id}`),
  runDiscovery: (score = true, collect = true) => request<DiscoveryRun>("POST", "/discover/run", { score, collect }),
  discoveryProgress: () => request<DiscoveryProgress>("GET", "/discover/progress"),
  /** Scores recent postings again (paid AI calls) without running the searches. */
  rescorePostings: (includeHidden = false) => request<DiscoveryRun>("POST", "/discover/rescore", { include_hidden: includeHidden }),
};
