import type { Ats, WatchSort, WatchStatus } from "@/api/discoverySettings";

export const ATS_LABELS: Record<Ats, string> = { ashby: "Ashby", greenhouse: "Greenhouse", lever: "Lever" };

export const STATUS_LABELS: Record<WatchStatus, string> = {
  on: "On",
  off: "Off",
  with_roles: "With roles",
  gone: "Board gone",
  error: "Read failed",
  unread: "Not read yet",
};

export const SORT_LABELS: Record<WatchSort, string> = { name: "Name", roles: "Most roles", checked: "Last read" };

export const WATCH_PAGE_SIZE = 50;
