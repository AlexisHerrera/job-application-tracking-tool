import { useState } from "react";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApplicationDetail } from "@/api/applications";
import { PlanDialog } from "./PlanDialog";
import { nodeKey } from "./timeline";
import { TimelineStep } from "./TimelineStep";

// The process at a glance: Applied → the steps (planned by hand, or just the interviews) → where it
// ended. The API builds the nodes (core/process.py); this draws them and edits the plan.

export function ProcessTimeline({ app }: { app: ApplicationDetail }) {
  const [planning, setPlanning] = useState(false);
  const nodes = app.timeline;
  const closed = nodes.some((n) => n.kind === "outcome" && n.outcome !== "on_hold");
  const ahead = nodes.some((n) => n.state === "scheduled" || n.state === "next" || n.state === "planned");
  const waiting = !closed && !ahead; // nothing known ahead: a soft "what's next" tail

  return (
    <section aria-label="Process" className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Process</span>
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setPlanning(true)}>
          <ListPlus /> {app.steps.length ? "Edit steps" : "Plan steps"}
        </Button>
      </div>
      <ol className="-mx-1 flex overflow-x-auto pt-1 pb-2">
        {nodes.map((n, i) => (
          <TimelineStep
            key={nodeKey(n, i)}
            node={n}
            first={i === 0}
            next={nodes[i + 1] ?? null}
            tail={waiting && i === nodes.length - 1}
            app={app}
            onPlan={() => setPlanning(true)}
          />
        ))}
        {waiting && (
          <li className="flex min-w-[5.5rem] flex-1 flex-col items-center px-1 text-center">
            <span className="relative grid h-6 w-full place-items-center">
              <span className="absolute top-1/2 right-1/2 left-0 border-t border-dashed border-foreground/15" />
              <span className="relative size-1.5 rounded-full bg-foreground/15" />
            </span>
            <span className="mt-1 text-xs text-muted-foreground/70">{app.steps.length === 0 && nodes.length === 1 ? "waiting" : "what's next?"}</span>
          </li>
        )}
      </ol>
      <PlanDialog app={app} open={planning} onOpenChange={setPlanning} />
    </section>
  );
}
