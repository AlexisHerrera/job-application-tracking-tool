import { label, type InterviewOutcome } from "@/api";

// Counts are small, so rates read "x of n" and say how many are still waiting. Colors reuse the
// flow chart's tokens (index.css, --flow-*): indigo for progress, rose for rejected, slate for no
// answer. "Waiting" is the empty track, never a fill.

export const OUTCOMES: { key: Exclude<InterviewOutcome, "waiting">; label: string; color: string }[] = [
  { key: "advanced", label: "Next round", color: "var(--flow-interviewing)" },
  { key: "rejected", label: "Rejected", color: "var(--flow-rejected)" },
  { key: "no_answer", label: "No answer", color: "var(--flow-ghosted)" },
  { key: "withdrew", label: "Withdrew", color: "var(--flow-withdrawn)" },
];
export const OUTCOME = Object.fromEntries(OUTCOMES.map((o) => [o.key, o])) as Record<string, (typeof OUTCOMES)[number]>;

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const typeLabel = (t: string) => (t === "not_set" ? "Type not set" : label(t).replace(/^./, (c) => c.toUpperCase()));
