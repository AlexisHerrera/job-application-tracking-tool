import type { DiscoveryStatus } from "./discovery";

/** GET /shell: everything the sidebar shows, in one request (the same parts as GET /scan,
 * /calendar and /discover/status, plus the inbox counts from /dashboard). */
export interface Shell {
  inbox: { unassigned: number; unassigned_interviews: number };
  scan: { available: boolean; last_scan_at: string | null };
  calendar: { connected: boolean; calendar_id: string; last_sync_at: string | null };
  discovery: DiscoveryStatus;
}
