import { Ghost, LogOut, Pause, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { errorText, fmtDate, relativeDay, type ApplicationDetail, type ProcessNode, type StepKind } from "@/api";

export const KIND_LABEL: Record<StepKind, string> = { interview: "Interview", take_home: "Take-home", other: "Other" };
export const OUTCOME_ICON = { rejected: X, withdrawn: LogOut, offer: Sparkles, ghosted: Ghost, on_hold: Pause } as const;
export const OUTCOME_DOT = {
  rejected: "bg-[var(--flow-rejected)]",
  withdrawn: "bg-[var(--flow-withdrawn)]",
  offer: "bg-[var(--flow-offer)]",
  ghosted: "bg-[var(--flow-ghosted)]",
  on_hold: "bg-[var(--flow-on-hold)]",
} as const;

export const shortDay = (iso: string) => fmtDate(iso).slice(0, 6);
export const reached = (n: ProcessNode) => n.state === "done" || n.state === "scheduled" || n.state === "outcome";
export const nodeKey = (n: ProcessNode, i: number) => n.step_id ?? n.interview_id ?? `${n.kind}-${i}`;

export async function attempt(p: Promise<unknown>, done: () => void) {
  try {
    await p;
    done();
  } catch (e) {
    toast.error(errorText(e));
  }
}

export function caption(n: ProcessNode, app: ApplicationDetail): string {
  if (n.kind === "outcome" && n.outcome === "ghosted") return app.last_event_at ? `since ${shortDay(app.last_event_at)}` : "";
  if (n.state === "scheduled" && n.at) return relativeDay(n.at);
  if (n.at && (n.state === "done" || n.state === "outcome")) return shortDay(n.at);
  if (n.implied) return "done";
  if (n.state === "next") return n.step_kind === "take_home" ? "to do" : "next";
  if (n.state === "skipped") return "skipped";
  if (n.optional && n.state === "planned") return "maybe";
  return "";
}

export function stateText(n: ProcessNode): string {
  const when = n.at ? fmtDate(n.at, n.state === "scheduled" || n.kind === "step" || n.kind === "interview") : "";
  switch (n.state) {
    case "done": return n.implied ? "Done: a later step already happened" : `Done · ${when}`;
    case "scheduled": return `Upcoming · ${when}`;
    case "next": return "Next up";
    case "planned": return n.optional ? "Planned · might not happen" : "Planned";
    case "skipped": return "Skipped";
    case "not_reached": return "Not reached";
    default: return when;
  }
}

// ---- the plan: what the recruiter said the process looks like ----

/** "1. Recruiter call", "- HR", "2) Tech" → the step names. */
export function parseSteps(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+\s*[.)-])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => l[0].toUpperCase() + l.slice(1));
}
