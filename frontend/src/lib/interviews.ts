import { CalendarDays, Mail, PenLine } from "lucide-react";
import { label } from "@/lib/format";
import { type Interview } from "@/api/interviews";

export const INTERVIEW_TYPES = ["recruiter", "technical", "system_design", "behavioral", "take_home", "onsite", "other"];
export const SOURCE_ICON = { calendar: CalendarDays, email: Mail, manual: PenLine } as const;
export const SOURCE_LABEL = { calendar: "From Google Calendar", email: "From an invite email", manual: "Added by hand" } as const;

/** "silver.dev" for a general talk: who it was with, since there's no company. */
export function talkWith(iv: Pick<Interview, "organizer" | "attendees">): string | null {
  const addr = iv.organizer ?? iv.attendees.find((a) => !a.endsWith("@gmail.com")) ?? iv.attendees[0];
  return addr ? addr.split("@").pop()! : null;
}

export function interviewName(iv: Pick<Interview, "title" | "interview_type" | "round">): string {
  const base = iv.title || (iv.interview_type ? label(iv.interview_type) : "Interview");
  return iv.round && !/round/i.test(base) ? `${base} · round ${iv.round}` : base;
}
