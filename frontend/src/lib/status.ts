import type { Stage, Status } from "../api";

// Board column order. Ghosted is computed by the API (no news for GHOST_DAYS), so it can't be a drop target.
export const STATUS_ORDER: Status[] = [
  "applied", "screening", "interviewing", "on_hold", "offer", "rejected", "withdrawn", "ghosted",
];
export const CLOSED_STATUSES = new Set<Status>(["offer", "rejected", "withdrawn"]);
export const ACTIVE_STATUSES = new Set<Status>(["applied", "screening", "interviewing", "on_hold"]);

export const STATUS_META: Record<Status, { label: string; dot: string; badge: string }> = {
  applied: { label: "Applied", dot: "bg-blue-500", badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  screening: { label: "Screening", dot: "bg-sky-500", badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  interviewing: { label: "Interviewing", dot: "bg-violet-500", badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  on_hold: { label: "On hold", dot: "bg-amber-500", badge: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  offer: { label: "Offer", dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  rejected: { label: "Rejected", dot: "bg-red-500", badge: "bg-red-500/10 text-red-700 dark:text-red-300" },
  withdrawn: { label: "Withdrawn", dot: "bg-zinc-400", badge: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300" },
  ghosted: { label: "Ghosted", dot: "bg-orange-400", badge: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
};

export const isStage = (s: Status): s is Stage => s !== "ghosted";
