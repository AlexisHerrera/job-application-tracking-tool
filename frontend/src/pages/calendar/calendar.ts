import type { ActivityItem, Process } from "@/api/dashboard";
import { talkWith } from "@/lib/interviews";
import { STATUS_META } from "@/lib/status";
import type { ParamsPatch } from "@/lib/useSearchParamsPatch";
import { cn } from "@/lib/utils";

/** The page's URL-param patch, handed down to both views. */
export type SetParams = (patch: ParamsPatch) => void;

// The board's status colors, except a first reply (amber: sky is too close to applied's blue).
export const KIND: Record<string, { label: string; dot: string }> = {
  applied: { label: "applied", dot: STATUS_META.applied.dot },
  reply: { label: "first reply", dot: "bg-amber-500" },
  rejected: { label: "rejected", dot: STATUS_META.rejected.dot },
  withdrawn: { label: "withdrew", dot: STATUS_META.withdrawn.dot },
  offer: { label: "offer", dot: STATUS_META.offer.dot },
};
export const isMeeting = (i: ActivityItem): i is Extract<ActivityItem, { kind: "interview" | "talk" }> => i.kind === "interview" || i.kind === "talk";
export const who = (i: ActivityItem) => (i.kind === "talk" ? `Talk · ${talkWith(i) ?? ""}` : i.company);

export const meetingChip = (upcoming: boolean, talk: boolean) =>
  cn(
    "rounded px-1.5 text-xs leading-5",
    talk ? "bg-muted text-muted-foreground" : upcoming ? "text-violet-700 ring-1 ring-violet-500/60 ring-inset dark:text-violet-300" : "bg-violet-500/15 text-violet-800 dark:text-violet-200",
  );

export const END_CAP: Partial<Record<Process["status"], string>> = {
  rejected: STATUS_META.rejected.dot,
  withdrawn: STATUS_META.withdrawn.dot,
  offer: STATUS_META.offer.dot,
  ghosted: STATUS_META.ghosted.dot,
};
export const OUTCOME_TEXT: Record<string, string> = {
  advanced: "went on to another round",
  rejected: "rejected after it",
  withdrew: "withdrew after it",
  no_answer: "no answer after it",
  waiting: "waiting to hear back",
};

/** Still running: no final answer and not ghosted. */
export const isOpen = (p: Process) => !p.ended_at && p.status !== "ghosted";
