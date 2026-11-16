import { useDroppable } from "@dnd-kit/core";
import { ChevronsLeftRight, ChevronsRightLeft, Clock } from "lucide-react";
import type { Application, Status } from "@/api";
import { StatusDot } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STATUS_META, isStage } from "@/lib/status";
import { cn } from "@/lib/utils";

export function BoardColumn({
  status, count, collapsed, onToggle, dragging, children,
}: {
  status: Status;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  dragging: Application | null;
  children: React.ReactNode;
}) {
  const droppable = isStage(status);
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !droppable });
  const meta = STATUS_META[status];
  const highlight = isOver && dragging && dragging.status !== status;
  const blocked = dragging && !droppable;

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={cn("flex w-11 shrink-0 flex-col items-center gap-3 rounded-xl bg-muted/50 py-3 transition-colors", highlight && "bg-primary/10 ring-2 ring-primary/40")}
      >
        <Button variant="ghost" size="icon-xs" onClick={onToggle} aria-label={`Expand ${meta.label}`}><ChevronsLeftRight /></Button>
        <StatusDot status={status} />
        <span className="text-sm font-medium [writing-mode:vertical-rl]">{meta.label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      </div>
    );
  }
  return (
    <section
      ref={setNodeRef}
      aria-label={`${meta.label}: ${count}`}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 transition-colors",
        highlight && "bg-primary/10 ring-2 ring-primary/40",
        blocked && "opacity-50",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <StatusDot status={status} />
        <h2 className="text-sm font-medium">{meta.label}</h2>
        <span className="rounded-full bg-background px-1.5 text-xs leading-5 font-medium text-muted-foreground tabular-nums">{count}</span>
        {status === "ghosted" && (
          <Tooltip>
            <TooltipTrigger asChild><Clock className="size-3.5 text-muted-foreground" /></TooltipTrigger>
            <TooltipContent>No news for a while. Computed, so it clears itself when an email arrives.</TooltipContent>
          </Tooltip>
        )}
        <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={onToggle} aria-label={`Collapse ${meta.label}`}><ChevronsRightLeft /></Button>
      </header>
      <div className="flex max-h-[calc(100svh-15rem)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
        {count === 0 && <div className="grid h-16 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">{droppable ? "Drop here" : "Nothing quiet"}</div>}
      </div>
    </section>
  );
}
