import type { Stage, Status } from "./applications";
import type { CampaignSummary } from "./campaigns";
import type { Interview } from "./interviews";

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
