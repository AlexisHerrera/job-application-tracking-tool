import type { ReactNode } from "react";

export function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{children}</div>;
}
