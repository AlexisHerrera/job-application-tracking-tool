import { useRef, useState, type KeyboardEvent } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent,
} from "@dnd-kit/core";
import { CalendarClock, Check, ChevronsLeftRight, ChevronsRightLeft, Clock, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtDate, type Application, type Stage, type Status } from "../../api";
import { ReviewBadge, StatusDot } from "../../components/common";
import { STATUS_META, STATUS_ORDER, isStage } from "../../lib/status";

const COLLAPSED_KEY = "jobtracker.board.collapsed";

function storedCollapsed(): Set<Status> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

// Pointer first (precise when the cursor is inside a column), rectangles as the keyboard fallback.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

// Soonest upcoming interview first, then most recent activity.
function byUrgency(a: Application, b: Application): number {
  const now = Date.now();
  const ia = time(a.next_interview_at) > now ? time(a.next_interview_at) : Infinity;
  const ib = time(b.next_interview_at) > now ? time(b.next_interview_at) : Infinity;
  if (ia !== ib) return ia - ib;
  return time(b.last_event_at ?? b.applied_at) - time(a.last_event_at ?? a.applied_at);
}

export function Board({
  apps, onOpen, onMove, onConfirm,
}: {
  apps: Application[];
  onOpen: (id: string) => void;
  onMove: (app: Application, stage: Stage) => void;
  onConfirm: (app: Application) => void;
}) {
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const [dragging, setDragging] = useState<Application | null>(null);
  const dropped = useRef(false);
  // Some browsers fire a click on the card right after a drop; that must not open it.
  const open = (id: string) => {
    if (!dropped.current) onOpen(id);
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a short press is still a click
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const toggle = (s: Status) => {
    const next = new Set(collapsed);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      /* private mode: layout just won't persist */
    }
  };

  function end(e: DragEndEvent) {
    setDragging(null);
    dropped.current = true;
    setTimeout(() => (dropped.current = false), 0);
    const app = e.active.data.current?.app as Application | undefined;
    const target = e.over?.id as Status | undefined;
    if (!app || !target || target === app.status || !isStage(target)) return;
    onMove(app, target);
  }

  const byStatus = new Map<Status, Application[]>(STATUS_ORDER.map((s) => [s, []]));
  for (const a of apps) byStatus.get(a.status)?.push(a);
  for (const list of byStatus.values()) list.sort(byUrgency);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={(e) => setDragging((e.active.data.current?.app as Application) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={end}
    >
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        {STATUS_ORDER.map((s) => (
          <Column key={s} status={s} count={byStatus.get(s)!.length} collapsed={collapsed.has(s)} onToggle={() => toggle(s)} dragging={dragging}>
            {byStatus.get(s)!.map((a) => <Card key={a.id} app={a} onOpen={open} onConfirm={onConfirm} />)}
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && <CardBody app={dragging} className="rotate-2 cursor-grabbing shadow-lg" />}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
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

function Card({ app, onOpen, onConfirm }: { app: Application; onOpen: (id: string) => void; onConfirm: (app: Application) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id, data: { app } });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") onOpen(app.id);
    else listeners?.onKeyDown?.(e);
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(app.id)}
      aria-roledescription="Draggable application. Space to pick up, Enter to open"
      className={cn("rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", isDragging && "opacity-40")}
    >
      <CardBody app={app} onConfirm={onConfirm} />
    </div>
  );
}

function CardBody({ app, onConfirm, className }: { app: Application; onConfirm?: (app: Application) => void; className?: string }) {
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
