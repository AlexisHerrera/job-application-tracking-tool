import { cn } from "@/lib/utils";
import type { ProcessNode } from "@/api/applications";
import { OUTCOME_DOT, OUTCOME_ICON } from "./timeline";

export function NodeDot({ n }: { n: ProcessNode }) {
  if (n.kind === "outcome" && n.outcome) {
    const Icon = OUTCOME_ICON[n.outcome];
    return (
      <span className={cn("grid size-5 place-items-center rounded-full text-white shadow-sm", OUTCOME_DOT[n.outcome])}>
        <Icon className="size-3" strokeWidth={2.5} />
      </span>
    );
  }
  // Take-homes are little diamonds; everything else is round.
  const shape = n.step_kind === "take_home" ? "size-2.5 rotate-45 rounded-[2px]" : "size-3 rounded-full";
  switch (n.state) {
    case "done":
      return <span className={cn(shape, n.implied ? "bg-[var(--flow-applied)]" : "bg-[var(--flow-interviewing)]", "ring-4 ring-indigo-500/10")} />;
    case "scheduled":
      return (
        <span className="relative grid place-items-center">
          <span className={cn("absolute animate-ping bg-violet-400/40", shape)} />
          <span className={cn(shape, "border-2 border-violet-500 bg-background")} />
        </span>
      );
    case "next":
      return <span className={cn(shape, "border-2 border-[var(--flow-screening)] bg-background")} />;
    case "planned":
      return <span className={cn(shape, "border-[1.5px] border-dashed border-muted-foreground/50 bg-background")} />;
    case "skipped":
      return <span className={cn(shape, "border border-muted-foreground/30 bg-background")} />;
    default: // not reached
      return <span className={cn(n.step_kind === "take_home" ? "size-2 rotate-45 rounded-[2px]" : "size-2 rounded-full", "bg-muted-foreground/20")} />;
  }
}
