import { useState } from "react";
import {
  ArrowDown, ArrowUp, Check, Ghost, ListPlus, LogOut, NotebookPen, Pause, Plus, Sparkles, Undo2, Video, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  api, dayToIso, errorText, fmtDate, isoToDay, relativeDay,
  type ApplicationDetail, type Interview, type ProcessNode, type ProcessStep, type StepKind,
} from "./api";
import { interviewName } from "@/lib/interviews";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { useRefresh } from "./lib/refresh";

// The process at a glance: Applied → the steps (planned by hand, or just the interviews) → where it
// ended. The API builds the nodes (core/process.py); this draws them and edits the plan.

const KIND_LABEL: Record<StepKind, string> = { interview: "Interview", take_home: "Take-home", other: "Other" };
const OUTCOME_ICON = { rejected: X, withdrawn: LogOut, offer: Sparkles, ghosted: Ghost, on_hold: Pause } as const;
const OUTCOME_DOT = {
  rejected: "bg-[var(--flow-rejected)]",
  withdrawn: "bg-[var(--flow-withdrawn)]",
  offer: "bg-[var(--flow-offer)]",
  ghosted: "bg-[var(--flow-ghosted)]",
  on_hold: "bg-[var(--flow-on-hold)]",
} as const;

const shortDay = (iso: string) => fmtDate(iso).slice(0, 6);
const reached = (n: ProcessNode) => n.state === "done" || n.state === "scheduled" || n.state === "outcome";
const nodeKey = (n: ProcessNode, i: number) => n.step_id ?? n.interview_id ?? `${n.kind}-${i}`;

async function attempt(p: Promise<unknown>, done: () => void) {
  try {
    await p;
    done();
  } catch (e) {
    toast.error(errorText(e));
  }
}

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

function Dot({ n }: { n: ProcessNode }) {
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

function caption(n: ProcessNode, app: ApplicationDetail): string {
  if (n.kind === "outcome" && n.outcome === "ghosted") return app.last_event_at ? `since ${shortDay(app.last_event_at)}` : "";
  if (n.state === "scheduled" && n.at) return relativeDay(n.at);
  if (n.at && (n.state === "done" || n.state === "outcome")) return shortDay(n.at);
  if (n.implied) return "done";
  if (n.state === "next") return n.step_kind === "take_home" ? "to do" : "next";
  if (n.state === "skipped") return "skipped";
  if (n.optional && n.state === "planned") return "maybe";
  return "";
}

function stateText(n: ProcessNode): string {
  const when = n.at ? fmtDate(n.at, n.state === "scheduled" || n.kind === "step" || n.kind === "interview") : "";
  switch (n.state) {
    case "done": return n.implied ? "Done: a later step already happened" : `Done · ${when}`;
    case "scheduled": return `Upcoming · ${when}`;
    case "next": return "Next up";
    case "planned": return n.optional ? "Planned · might not happen" : "Planned";
    case "skipped": return "Skipped";
    case "not_reached": return "Not reached";
    default: return when;
  }
}

function TimelineStep({ node: n, first, next, tail, app, onPlan }: {
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
              <span className="grid place-items-center rounded-full bg-background p-0.5 transition-transform group-hover:scale-125"><Dot n={n} /></span>
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
            <span className="text-[11px] leading-4 text-muted-foreground tabular-nums">{caption(n, app) || " "}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="center">
          <NodeDetails n={n} app={app} close={() => setOpen(false)} onPlan={() => { setOpen(false); onPlan(); }} />
        </PopoverContent>
      </Popover>
    </li>
  );
}

function NodeDetails({ n, app, close, onPlan }: { n: ProcessNode; app: ApplicationDetail; close: () => void; onPlan: () => void }) {
  const { bump } = useRefresh();
  const openEditor = useOpenEditor();
  const iv = n.interview_id ? app.interviews.find((i) => i.id === n.interview_id) : undefined;
  const step = n.step_id ? app.steps.find((s) => s.id === n.step_id) : undefined;
  const done = () => { bump(); close(); };

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex items-center gap-1.5 font-medium">
          {n.label}
          {n.step_kind && n.step_kind !== "interview" && <span className="rounded bg-muted px-1.5 text-[11px] leading-5 font-normal text-muted-foreground">{KIND_LABEL[n.step_kind].toLowerCase()}</span>}
          {n.optional && <span className="rounded bg-muted px-1.5 text-[11px] leading-5 font-normal text-muted-foreground">maybe</span>}
          {n.kind === "interview" && <span className="rounded bg-muted px-1.5 text-[11px] leading-5 font-normal text-muted-foreground">not in the plan</span>}
        </div>
        <div className="text-xs text-muted-foreground">{n.kind === "outcome" && n.outcome === "ghosted" ? `No news for a while${app.last_event_at ? `, last on ${fmtDate(app.last_event_at)}` : ""}` : stateText(n)}</div>
      </div>

      {iv && <InterviewBox iv={iv} label={n.label} onOpen={() => { close(); openEditor("interview", iv.id); }} />}
      {step && <StepActions step={step} n={n} app={app} done={done} />}
      {n.kind === "interview" && iv && <UseForStep iv={iv} app={app} done={done} />}
      {n.kind === "outcome" && <p className="text-xs text-muted-foreground">Change it from the stage badge.</p>}
      {n.kind === "applied" && app.steps.length === 0 && (
        <p className="text-xs text-muted-foreground">Know how the process goes? Plan its steps and the calendar interviews will fall into place.</p>
      )}

      {(step || n.kind === "applied") && (
        <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" onClick={onPlan}><ListPlus /> {app.steps.length ? "Edit steps" : "Plan steps"}</Button>
      )}
    </div>
  );
}

function InterviewBox({ iv, label, onOpen }: { iv: Interview; label: string; onOpen: () => void }) {
  const upcoming = new Date(iv.starts_at) > new Date();
  const name = interviewName(iv);
  return (
    <div className="space-y-2 rounded-lg border p-2.5">
      <div className="text-xs">
        {name !== label && <div className="truncate font-medium">{name}</div>}
        <div className="text-muted-foreground tabular-nums">{fmtDate(iv.starts_at, true)} · {relativeDay(iv.starts_at)}</div>
      </div>
      <div className="flex gap-1.5">
        <Button size="xs" variant="outline" onClick={onOpen}><NotebookPen /> {iv.notes_count ? `Notes · ${iv.notes_count}` : upcoming ? "Prep notes" : "Write notes"}</Button>
        {upcoming && iv.meeting_url && (
          <Button asChild size="xs" variant="ghost"><a href={iv.meeting_url} target="_blank" rel="noreferrer"><Video /> Join</a></Button>
        )}
      </div>
    </div>
  );
}

function StepActions({ step, n, app, done }: { step: ProcessStep; n: ProcessNode; app: ApplicationDetail; done: () => void }) {
  const [day, setDay] = useState(() => isoToDay(new Date().toISOString()));
  const ivs = [...app.interviews].filter((i) => i.status === "scheduled").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const linkValue = step.link === "auto" ? "auto" : step.interview_id ?? "none";
  const setLink = (v: string) =>
    attempt(api.updateStep(step.id, v === "auto" ? { link: "auto" } : { interview_id: v === "none" ? null : v }), done);

  return (
    <div className="space-y-2.5">
      {step.kind === "interview" && (
        <div className="space-y-1">
          <Label htmlFor={`link-${step.id}`} className="text-xs text-muted-foreground">Interview</Label>
          <NativeSelect id={`link-${step.id}`} size="sm" className="w-full" value={linkValue} onChange={(e) => void setLink(e.target.value)}>
            <NativeSelectOption value="auto">Automatic: next one in time</NativeSelectOption>
            <NativeSelectOption value="none">Hasn't happened yet</NativeSelectOption>
            {ivs.map((i) => <NativeSelectOption key={i.id} value={i.id}>{shortDay(i.starts_at)} · {interviewName(i)}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      )}
      {step.done_at ? (
        <div className="flex items-center gap-2 text-xs">
          <Check className="size-3.5 text-[var(--flow-interviewing)]" /> Marked done on {fmtDate(step.done_at)}
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void attempt(api.updateStep(step.id, { done_at: null }), done)}><Undo2 /> Undo</Button>
        </div>
      ) : !n.interview_id && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => { e.preventDefault(); void attempt(api.updateStep(step.id, { done_at: dayToIso(day) }), done); }}
        >
          <Input type="date" aria-label="Done on" className="h-7 flex-1 text-xs" value={day} onChange={(e) => setDay(e.target.value)} required />
          <Button type="submit" size="xs"><Check /> Mark done</Button>
        </form>
      )}
    </div>
  );
}

/** An interview no step took: say which step it was. */
function UseForStep({ iv, app, done }: { iv: Interview; app: ApplicationDetail; done: () => void }) {
  const steps = app.steps.filter((s) => s.kind === "interview");
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1">
      <Label htmlFor={`use-${iv.id}`} className="text-xs text-muted-foreground">It was the step…</Label>
      <NativeSelect
        id={`use-${iv.id}`}
        size="sm"
        className="w-full"
        value=""
        onChange={(e) => e.target.value && void attempt(api.updateStep(e.target.value, { interview_id: iv.id }), done)}
      >
        <NativeSelectOption value="">Extra: not in the plan</NativeSelectOption>
        {steps.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.position + 1}. {s.name}</NativeSelectOption>)}
      </NativeSelect>
    </div>
  );
}

// ---- the plan: what the recruiter said the process looks like ----

/** "1. Recruiter call", "- HR", "2) Tech" → the step names. */
function parseSteps(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+\s*[.)-])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => l[0].toUpperCase() + l.slice(1));
}

function PlanDialog({ app, open, onOpenChange }: { app: ApplicationDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { bump } = useRefresh();
  const [text, setText] = useState("");
  const names = parseSteps(text);

  async function add() {
    await attempt(api.addSteps(app.id, names.map((name) => ({ name }))), () => { setText(""); bump(); });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Process steps · {app.company}</DialogTitle>
          <DialogDescription>
            What the recruiter said to expect. Interview steps pick up the calendar interviews in order; take-homes you mark done yourself from the timeline.
          </DialogDescription>
        </DialogHeader>
        {app.steps.length > 0 && (
          <ol className="space-y-1.5" aria-label="Steps">
            {app.steps.map((st, i) => (
              <PlanRow key={`${st.id}-${st.name}`} step={st} index={i} count={app.steps.length} onDone={bump} />
            ))}
          </ol>
        )}
        <div className="space-y-2">
          <Label htmlFor="plan-add">{app.steps.length ? "Add more steps" : "Steps, one per line"}</Label>
          <Textarea
            id="plan-add"
            rows={app.steps.length ? 2 : 5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && names.length) { e.preventDefault(); void add(); } }}
            placeholder={"Recruiter call\nAgency director\nHR director\nChallenge\nChallenge defense + interview"}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">"Challenge", "take-home"… become take-homes. Change any kind below.</p>
            <Button size="sm" disabled={!names.length} onClick={add}><Plus /> Add{names.length ? ` ${names.length}` : ""}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanRow({ step, index, count, onDone }: { step: ProcessStep; index: number; count: number; onDone: () => void }) {
  const [name, setName] = useState(step.name);
  const save = (data: Parameters<typeof api.updateStep>[1]) => attempt(api.updateStep(step.id, data), onDone);
  return (
    <li className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
      <Input
        aria-label={`Step ${index + 1} name`}
        className="h-8 min-w-0 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name.trim() !== step.name) void save({ name: name.trim() }); else setName(step.name); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <NativeSelect size="sm" aria-label="Kind" className="w-28" value={step.kind} onChange={(e) => void save({ kind: e.target.value as StepKind })}>
        {(Object.keys(KIND_LABEL) as StepKind[]).map((k) => <NativeSelectOption key={k} value={k}>{KIND_LABEL[k]}</NativeSelectOption>)}
      </NativeSelect>
      <Button
        variant={step.optional ? "secondary" : "ghost"}
        size="xs"
        aria-pressed={step.optional}
        title="Might not happen (e.g. 4–5 rounds)"
        className={cn(!step.optional && "text-muted-foreground")}
        onClick={() => void save({ optional: !step.optional })}
      >
        maybe
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={index === 0} onClick={() => void save({ position: index - 1 })}><ArrowUp /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={index === count - 1} onClick={() => void save({ position: index + 1 })}><ArrowDown /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Delete step" onClick={() => void attempt(api.deleteStep(step.id), onDone)}><X /></Button>
    </li>
  );
}
