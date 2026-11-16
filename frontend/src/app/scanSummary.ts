import type { CalendarSyncResult, ScanResult } from "@/api";

export function scanSummary(r: ScanResult): string {
  if (r.started_fresh) return "Now watching your inbox. New mail from here on will be picked up.";
  if (r.seen === 0) return "No new mail.";
  const parts = [`${r.seen} new email${r.seen === 1 ? "" : "s"}`, `${r.job} job-related`];
  if (r.created) parts.push(`${r.created} new application${r.created === 1 ? "" : "s"}`);
  if (r.unassigned) parts.push(`${r.unassigned} to the inbox`);
  return parts.join(" · ");
}

export function calendarSummary(r: CalendarSyncResult): string | null {
  const parts = [];
  if (r.created) parts.push(`${r.created} new interview${r.created === 1 ? "" : "s"} from the calendar`);
  if (r.cancelled) parts.push(`${r.cancelled} cancelled`);
  if (r.unassigned) parts.push(`${r.unassigned} to match`);
  return parts.length ? parts.join(" · ") : null;
}
