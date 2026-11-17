import type { ReactNode } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "pending" | "active" | "done";

export function ProgressStep({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0">
        {state === "done" ? (
          <Check className="size-4 text-good" />
        ) : state === "active" ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : (
          <Circle className="size-4 text-muted-foreground/50" />
        )}
      </span>
      <div className={cn("min-w-0 flex-1", state === "pending" && "text-muted-foreground")}>
        <div className={cn("text-sm", state === "active" && "font-medium")}>{title}</div>
        {children && <div className="text-xs text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}
