import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Any mutation calls bump(); every useAsync reloads. Data is small (hundreds of rows), so
// refetching beats keeping per-view caches in sync.
const Ctx = createContext({ version: 0, bump: () => {} });

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  return <Ctx.Provider value={{ version, bump }}>{children}</Ctx.Provider>;
}

export const useRefresh = () => useContext(Ctx);
