import type { ApplicationDetail, TimelineEvent } from "@/api";
import { CLOSED_STATUSES } from "@/lib/status";

// Same rule as the dashboard (stats.awaiting_reply): closed or on-hold processes need nothing
// from you, and any later event means the request was handled.
export function awaitingReply(app: ApplicationDetail, e: TimelineEvent): boolean {
  if (!e.needs_reply || e.replied_at || CLOSED_STATUSES.has(app.status) || app.status === "on_hold") return false;
  return !app.events.some((other) => other.occurred_at > e.occurred_at);
}
