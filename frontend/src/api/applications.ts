import type { Interview, Note } from "./interviews";

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

export interface ApplicationDetail extends Application {
  events: TimelineEvent[];
  interviews: Interview[];
  interview_notes: Note[];
  steps: ProcessStep[];
  timeline: ProcessNode[];
  aliases: { kind: string; value: string; learned_from: string }[];
}

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

export type ApplicationInput = Partial<Omit<Application, "id" | "status">> & {
  company: string;
  role_title: string;
  company_domain?: string;
  stage?: Stage | null;
  stage_at?: string | null;
  process_steps?: StepInput[];
};

export type StepInput = { name: string; kind?: StepKind | null; optional?: boolean };
