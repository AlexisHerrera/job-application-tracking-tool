import { useMemo, type ReactNode } from "react";
import type { DiscoveryStatus } from "@/api/discovery";
import { useShellStatus } from "@/features/shell/shellStatus";

interface DiscoveryStatusState {
  status: DiscoveryStatus | null;
  /** Call after anything that moves the Review count or the last run: a decision on a posting,
   * a run, saving the rules. */
  refresh: () => void;
}

/** The sidebar's Review count and "Job sources" line: the discovery part of GET /shell
 * (ShellStatusProvider), so it loads with the rest of the sidebar. refresh() reloads the shell. */
export function useDiscoveryStatus(): DiscoveryStatusState {
  const { shell, refresh } = useShellStatus();
  const status = shell?.discovery ?? null;
  return useMemo(() => ({ status, refresh }), [status, refresh]);
}

/** Loads nothing any more: the shell's one request (ShellStatusProvider, in App) has the status.
 * Kept only because main.tsx still mounts it; drop both together. */
export function DiscoveryStatusProvider({ children }: { children: ReactNode }) {
  return children;
}
