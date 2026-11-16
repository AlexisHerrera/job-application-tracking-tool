import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ApplicationDetail, ProcessNode } from "@/api";
import { NodeDetails } from "./NodeDetails";
import { NodeDot } from "./NodeDot";
import { caption, reached, stateText } from "./timeline";

export function TimelineStep({ node: n, first, next, tail, app, onPlan }: {
  node: ProcessNode;
  first: boolean;
  next: ProcessNode | null;
  tail: boolean;
  app: ApplicationDetail;
  onPlan: () => void;
}) {
  const [open, setOpen] = useState(false);
  const line = (to: ProcessNode | null) =>
    to && reached(to) && to.outcome !== "ghosted" ? "border-solid border-[var(--flow-applied)]/70" : "border-dashed border-foreground/15";
  const muted = n.state === "not_reached" || n.state === "planned" || n.state === "skipped";

  return (
    <li className="relative flex min-w-[5.5rem] flex-1 flex-col items-center px-1 text-center">
      {/* The connector is two halves: into this node, styled by it; out of it, by the next one. */}
      {!first && <span aria-hidden className={cn("absolute top-[0.75rem] right-1/2 left-0 border-t", line(n))} />}
      {(next || tail) && <span aria-hidden className={cn("absolute top-[0.75rem] right-0 left-1/2 border-t", line(next))} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group relative flex max-w-full flex-col items-center rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={`${n.label}: ${stateText(n)}`}
          >
            <span className="grid h-6 place-items-center bg-transparent">
              <span className="grid place-items-center rounded-full bg-background p-0.5 transition-transform group-hover:scale-125"><NodeDot n={n} /></span>
            </span>
            <span className={cn(
              "mt-1 line-clamp-2 max-w-[7.5rem] text-xs leading-tight group-hover:underline",
              n.state === "scheduled" && "font-medium",
              muted && "text-muted-foreground",
              n.state === "not_reached" && "text-muted-foreground/60",
              n.state === "skipped" && "line-through",
            )}>
              {n.label}
            </span>
            <span className="text-[11px] leading-4 text-muted-foreground tabular-nums">{caption(n, app) || " "}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="center">
          <NodeDetails n={n} app={app} close={() => setOpen(false)} onPlan={() => { setOpen(false); onPlan(); }} />
        </PopoverContent>
      </Popover>
    </li>
  );
}
