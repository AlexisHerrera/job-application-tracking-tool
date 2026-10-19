// Typed client for the FastAPI backend. Same origin, so Cloudflare Access cookies ride along.

export type Status =
  | "applied" | "screening" | "interviewing" | "offer" | "rejected" | "withdrawn" | "ghosted";
export const STAGES = ["applied", "screening", "interviewing", "offer", "rejected", "withdrawn"] as const;
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

export interface Note {
  id: string;
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

export interface ApplicationDetail extends Application {
  events: TimelineEvent[];
  interview_notes: Note[];
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
  upcoming_interviews: { application_id: string; company: string; role: string; round: number | null; at: string }[];
  follow_ups: {
    needs_reply: { event_id: string; application_id: string | null; company: string | null; subject: string; received_at: string }[];
    no_news: { application_id: string; company: string; role: string; last_event_at: string | null }[];
  };
  needs_review: number;
  unassigned: number;
  campaign: CampaignSummary | null;
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
  company: string;
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
    // Required by CloudFront OAC in front of the Lambda Function URL for requests with a body.
    headers["x-amz-content-sha256"] = await sha256Hex(payload);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: "same-origin" });
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
};

export const api = {
  dashboard: () => request<Dashboard>("GET", "/dashboard"),
  applications: (params: Record<string, string> = {}) =>
    request<Application[]>("GET", `/applications?${new URLSearchParams(params)}`),
  application: (id: string) => request<ApplicationDetail>("GET", `/applications/${id}`),
  createApplication: (data: ApplicationInput) => request<Application>("POST", "/applications", data),
  paste: (text: string, applicationId?: string) =>
    request<{ records: PasteRecord[]; llm_input_tokens: number; llm_output_tokens: number }>("POST", "/paste", {
      text,
      application_id: applicationId ?? null,
    }),
  updateApplication: (id: string, data: Partial<Application> & { company_domain?: string }) =>
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
  createFromEvent: (eventId: string, data: ApplicationInput) =>
    request<Application>("POST", `/events/${eventId}/create-application`, data),
  addNote: (appId: string, data: Partial<Note>) => request<Note>("POST", `/applications/${appId}/notes`, data),
  deleteNote: (noteId: string) => request<void>("DELETE", `/notes/${noteId}`),
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

export function daysAgo(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

export const label = (s: string) => s.replace(/_/g, " ");

export function fmtSalary(a: Pick<Application, "salary_min" | "salary_max" | "salary_currency">): string | null {
  if (!a.salary_min && !a.salary_max) return null;
  const n = (v: number) => new Intl.NumberFormat("en-US").format(v);
  const range = a.salary_min && a.salary_max && a.salary_min !== a.salary_max
    ? `${n(a.salary_min)}–${n(a.salary_max)}`
    : n((a.salary_min || a.salary_max)!);
  return `${a.salary_currency ?? ""} ${range} / year`.trim();
}
