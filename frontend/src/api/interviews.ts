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

export interface InterviewDetail extends Interview {
  role: string | null;
  notes_list: Note[];
}

export interface NoteDetail extends Note {
  application_id: string;
  company: string | null;
  role: string | null;
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
