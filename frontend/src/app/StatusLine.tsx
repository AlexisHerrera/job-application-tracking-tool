import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One line of the sidebar's footer: what, how long ago, and an optional button after it. */
export function StatusLine({ label, when, error, children }: { label: string; when: string; error?: boolean; children?: ReactNode }) {
  return (
    <>
      <span className="w-26 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate tabular-nums", error ? "font-medium text-destructive" : "text-foreground/80")}>{when}</span>
      {children}
    </>
  );
}
