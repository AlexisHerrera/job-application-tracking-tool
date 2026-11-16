import { Banknote, CalendarClock, Check } from "lucide-react";
import { fmtDate, type Application } from "@/api";
import { ReviewBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

// The card's look, also drawn as the drag overlay (without `onConfirm`).
export function BoardCardBody({ app, onConfirm, className }: { app: Application; onConfirm?: (app: Application) => void; className?: string }) {
  const upcoming = app.next_interview_at && new Date(app.next_interview_at) > new Date();
  const salary = app.salary_max || app.salary_min;
  return (
    <div className={cn("group cursor-grab rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition-colors hover:border-foreground/20", className)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{app.company}</div>
          <div className="line-clamp-2 text-sm text-muted-foreground">{app.role_title}</div>
        </div>
        {app.needs_review && onConfirm && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-xs"
                aria-label={`Confirm ${app.company} looks right`}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onConfirm(app); }}
              >
                <Check />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Looks right</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        {app.needs_review && <ReviewBadge />}
        {app.current_round ? <span className="rounded bg-muted px-1.5 leading-5 font-medium">R{app.current_round}</span> : null}
        {upcoming && (
          <span className="inline-flex items-center gap-1 font-medium text-violet-700 dark:text-violet-300">
            <CalendarClock className="size-3.5" />{fmtDate(app.next_interview_at, true)}
          </span>
        )}
        {salary ? (
          <span className="inline-flex items-center gap-1">
            <Banknote className="size-3.5" />{app.salary_currency ?? ""} {Math.round(salary / 1000)}k
          </span>
        ) : null}
        <span className="ml-auto tabular-nums">{shortAgo(app.last_event_at ?? app.applied_at)}</span>
      </div>
    </div>
  );
}
