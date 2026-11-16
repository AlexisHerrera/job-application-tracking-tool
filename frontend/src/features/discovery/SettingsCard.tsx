import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One block of the Criteria and Sources pages: a title, what it does, and its fields. */
export function SettingsCard({ title, hint, aside, children, className }: { title: ReactNode; hint?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 rounded-lg border bg-card p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
