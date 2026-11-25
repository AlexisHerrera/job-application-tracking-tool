import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/api/client";
import type { Shell } from "@/api/shell";
import { useAsync } from "@/lib/useAsync";

interface ShellStatusState {
  shell: Shell | null;
  /** Call after anything that moves a sidebar count or status line outside of bump(). */
  refresh: () => void;
}

const Ctx = createContext<ShellStatusState>({ shell: null, refresh: () => {} });

/** What the sidebar shows (inbox and Review counts, the "Job sources" and "Mail & calendar"
 * lines), loaded once for the whole shell with one GET /shell: in prod every request a page fires
 * at the same time costs its own, often cold, Lambda instance. It reloads on every navigation,
 * on bump(), and on refresh(). */
export function ShellStatusProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { data, reload } = useAsync(api.shell, [pathname]);
  const value = useMemo(() => ({ shell: data, refresh: () => void reload() }), [data, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShellStatus = () => useContext(Ctx);
