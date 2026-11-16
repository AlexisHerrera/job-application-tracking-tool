import type { DiscoveryRun } from "@/api/discovery";

/** What the sidebar says when the last discovery run had errors, or null when it had none. */
export function runErrors(run: DiscoveryRun | null | undefined): string | null {
  if (!run || run.errors === 0) return null;
  return `The last run had ${run.errors} error${run.errors === 1 ? "" : "s"}`;
}
