import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/api/client";
import type { DiscoveryStatus } from "@/api/discovery";
import { useAsync } from "@/lib/useAsync";

interface DiscoveryStatusState {
  status: DiscoveryStatus | null;
  /** Call after anything that moves the Review count or the last run: a decision on a posting,
   * a run, saving the rules. */
  refresh: () => void;
}

const Ctx = createContext<DiscoveryStatusState>({ status: null, refresh: () => {} });

/** The sidebar's Review count and "Job sources" line, loaded once for the whole shell (the light
 * GET /discover/status, not the settings). It reloads on every navigation, on bump(), and when a
 * Discover page calls refresh(). */
export function DiscoveryStatusProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { data, reload } = useAsync(api.discoveryStatus, [pathname]);
  const value = useMemo(() => ({ status: data, refresh: () => void reload() }), [data, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDiscoveryStatus = () => useContext(Ctx);
