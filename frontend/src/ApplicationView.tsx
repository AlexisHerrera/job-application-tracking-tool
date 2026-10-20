import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AtSign, Banknote, Briefcase, CalendarClock, CalendarDays, Check, ChevronDown, Gift, Hash, Layers, Link2, Mail,
  MapPin, Maximize2, MousePointerClick, NotebookPen, PenLine, Radio, Sparkles, Star, Trash2, TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  STAGES, api, dayToIso, daysAgo, errorText, fmtDate, fmtSalary, isoToDay, label,
  type Application, type ApplicationDetail, type Stage, type TimelineEvent,
} from "./api";
import { CHANNELS, SENIORITY } from "./ApplicationForm";
import { InterviewsAndNotes } from "./InterviewNotes";
import { Loading, StatusBadge, StatusDot } from "./components/common";
import { CLOSED_STATUSES, STATUS_META } from "./lib/status";
import { useRefresh } from "./lib/refresh";
import { PasteAssistant } from "./PasteAssistant";
import { SalaryInputs, draftFrom, readSalary } from "./SalaryInput";
import { useAsync } from "./useAsync";

type Patch = Parameters<typeof api.updateApplication>[1];

export function ApplicationView({ id, inSheet = false, onDeleted }: { id: string; inSheet?: boolean; onDeleted?: () => void }) {
  const { bump } = useRefresh();
  const { data: app, error, loading } = useAsync(() => api.application(id), [id]);
  if (!app) return <div className="p-6"><Loading error={error} loading={loading} /></div>;

  async function save(patch: Patch) {
    try {
      await api.updateApplication(id, patch);
      bump();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function setStage(stage: Stage, round?: number | null) {
    try {
      await api.changeStage(id, { stage, round });
      toast.success(round ? `Round ${round}` : `Moved to ${STATUS_META[stage].label}`);
      bump();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <div className="flex flex-col">
      <header className={cn("space-y-3 border-b pb-5", inSheet ? "px-6 pt-6" : "")}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Briefcase className="size-4" />
          <span>Application</span>
          {inSheet && (
            <Button asChild variant="ghost" size="xs" className="ml-auto mr-8">
              <Link to={`/applications/${app.id}`}><Maximize2 /> Open page</Link>
            </Button>
          )}
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{app.company}</h2>
          <EditableText
            value={app.role_title}
            required
            className="-ml-2 text-base text-muted-foreground"
            onSave={(v) => save({ role_title: v ?? undefined })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StagePicker app={app} onPick={(s) => setStage(s)} />
          {app.next_interview_at && (
            <span className="inline-flex items-center gap-1 text-sm">
              <CalendarClock className="size-4 text-violet-500" /> {fmtDate(app.next_interview_at, true)}
            </span>
          )}
          {app.job_url && (
            <Button asChild variant="outline" size="xs">
              <a href={app.job_url} target="_blank" rel="noreferrer"><Link2 /> Posting</a>
            </Button>
          )}
        </div>
        {app.needs_review && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <Sparkles className="size-4 text-amber-600" />
            <span className="flex-1">Created automatically from an email. Check the company and role.</span>
            <Button size="sm" onClick={async () => { await api.markReviewed(app.id); toast.success("Marked as reviewed"); bump(); }}>
              <Check /> Looks right
            </Button>
          </div>
        )}
      </header>

      <div className={cn("space-y-8 py-5", inSheet && "px-6")}>
        <Properties app={app} save={save} setStage={setStage} />

        <Section icon={Mail} title="Timeline">
          {app.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet. Emails show up here.</p>
          ) : (
            <ol className="relative space-y-4 border-l pl-5">
              {[...app.events].reverse().map((e) => <EventItem key={e.id} e={e} awaiting={awaitingReply(app, e)} onDone={bump} />)}
            </ol>
          )}
        </Section>

        <Section icon={NotebookPen} title="Interviews & notes">
          <InterviewsAndNotes app={app} onDone={bump} />
        </Section>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="group"><Sparkles /> Paste more info <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <PasteAssistant applicationId={app.id} onApplied={bump} />
          </CollapsibleContent>
        </Collapsible>

        <Separator />
        <DeleteButton app={app} onDeleted={() => { bump(); onDeleted?.(); }} />
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{title}</h3>
      {children}
    </section>
  );
}

export function StagePicker({ app, onPick }: { app: Application; onPick: (s: Stage) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Change stage">
          <StatusBadge status={app.status} />
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STAGES.map((s) => (
          <DropdownMenuItem key={s} disabled={s === app.current_stage && app.status !== "ghosted"} onSelect={() => onPick(s)}>
            <StatusDot status={s} /> {STATUS_META[s].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Prop({ icon: Icon, label: text, children }: { icon: typeof Mail; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <div className="flex h-8 items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4 shrink-0" />{text}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Properties({ app, save, setStage }: { app: ApplicationDetail; save: (p: Patch) => Promise<void>; setStage: (s: Stage, round?: number | null) => Promise<void> }) {
  const domains = app.aliases.filter((a) => a.kind === "domain").map((a) => a.value);
  const others = app.aliases.filter((a) => a.kind !== "domain").map((a) => a.value);
  return (
    <div className="space-y-0.5">
      <Prop icon={CalendarDays} label="Applied">
        <EditableText
          type="date"
          value={isoToDay(app.applied_at)}
          display={app.applied_at ? <>{fmtDate(app.applied_at)} <span className="text-muted-foreground">· {daysAgo(app.applied_at)}</span></> : null}
          onSave={(v) => save({ applied_at: v ? dayToIso(v) : null })}
        />
      </Prop>
      <Prop icon={TrendingUp} label="Progress">
        <div className="flex h-8 items-center gap-2 px-2 text-sm">
          furthest: {label(app.max_stage_reached)}
          {app.last_event_at && <span className="text-muted-foreground">· last activity {daysAgo(app.last_event_at)}</span>}
        </div>
      </Prop>
      <Prop icon={Hash} label="Round">
        <EditableText
          type="number"
          value={app.current_round?.toString() ?? ""}
          placeholder="—"
          onSave={(v) => setStage(app.current_stage, v ? Number(v) : null)}
        />
      </Prop>
      <Prop icon={Banknote} label="Salary">
        <SalaryField app={app} save={save} />
      </Prop>
      <Prop icon={Gift} label="Benefits">
        <EditableText multiline value={app.benefits ?? ""} placeholder="Equity, bonus, PTO…" onSave={(v) => save({ benefits: v })} />
      </Prop>
      <Prop icon={Radio} label="Channel">
        <SelectField value={app.source_channel ?? ""} options={CHANNELS} onSave={(v) => save({ source_channel: v })} />
      </Prop>
      <Prop icon={MousePointerClick} label="ATS">
        <EditableText value={app.source_ats ?? ""} placeholder="ashby, lever…" onSave={(v) => save({ source_ats: v })} />
      </Prop>
      <Prop icon={Star} label="Seniority">
        <SelectField value={app.seniority ?? ""} options={SENIORITY} onSave={(v) => save({ seniority: v })} />
      </Prop>
      <Prop icon={Layers} label="Stack">
        <EditableText
          value={app.stack.join(", ")}
          display={app.stack.length ? (
            <span className="flex flex-wrap gap-1">{app.stack.map((s) => <span key={s} className="rounded bg-muted px-1.5 text-xs leading-5">{s}</span>)}</span>
          ) : null}
          placeholder="python, aws, react"
          onSave={(v) => save({ stack: (v ?? "").split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </Prop>
      <Prop icon={MapPin} label="Location">
        <EditableText value={app.location ?? ""} placeholder="Remote (LATAM)" onSave={(v) => save({ location: v })} />
      </Prop>
      <Prop icon={Link2} label="Posting">
        <EditableText
          type="url"
          value={app.job_url ?? ""}
          display={app.job_url ? <span className="block truncate text-primary underline-offset-4">{app.job_url}</span> : null}
          placeholder="https://…"
          onSave={(v) => save({ job_url: v })}
        />
      </Prop>
      <Prop icon={AtSign} label="Mail from">
        <div className="space-y-1">
          {(domains.length > 0 || others.length > 0) && (
            <div className="flex flex-wrap gap-1 px-2 pt-1.5">
              {[...domains, ...others].map((v) => <span key={v} className="rounded bg-muted px-1.5 text-xs leading-5">{v}</span>)}
            </div>
          )}
          <EditableText value="" placeholder="+ add company email domain" onSave={(v) => (v ? save({ company_domain: v }) : Promise.resolve())} />
        </div>
      </Prop>
      <Prop icon={PenLine} label="Notes">
        <EditableText multiline value={app.notes ?? ""} onSave={(v) => save({ notes: v })} />
      </Prop>
      <Prop icon={Briefcase} label="Description">
        <EditableText multiline clamp value={app.job_description ?? ""} placeholder="Paste the job description" onSave={(v) => save({ job_description: v })} />
      </Prop>
    </div>
  );
}

const ghostField =
  "flex min-h-8 w-full items-center rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 outline-none";

export function EditableText({
  value, onSave, display, placeholder = "Empty", multiline = false, clamp = false, required = false, type = "text", className,
}: {
  value: string;
  onSave: (v: string | null) => Promise<void>;
  display?: ReactNode;
  placeholder?: string;
  multiline?: boolean;
  clamp?: boolean;
  required?: boolean;
  type?: "text" | "number" | "date" | "url";
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const done = useRef(false);

  const start = () => {
    setDraft(value);
    done.current = false;
    setEditing(true);
  };
  const commit = async () => {
    if (done.current) return; // Enter commits, then the unmount blur must not commit again
    done.current = true;
    setEditing(false);
    const v = draft.trim();
    if (v === value.trim() || (required && !v)) return;
    await onSave(v || null);
  };

  if (!editing) {
    const shown = display ?? (value ? value : null);
    return (
      <button type="button" onClick={start} className={cn(ghostField, multiline && "items-start whitespace-pre-wrap", className)}>
        {shown ? (
          <span className={cn("min-w-0", clamp && "line-clamp-4")}>{shown}</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </button>
    );
  }
  const common = {
    autoFocus: true,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // keep the sheet open
        done.current = true;
        setEditing(false);
      } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void commit();
      }
    },
  };
  return multiline ? (
    <div className="space-y-1">
      <Textarea rows={5} {...common} />
      <p className="text-xs text-muted-foreground">⌘/Ctrl + Enter to save · Esc to cancel</p>
    </div>
  ) : (
    <Input type={type} min={type === "number" ? 1 : undefined} {...common} />
  );
}

function SelectField({ value, options, onSave }: { value: string; options: string[]; onSave: (v: string | null) => Promise<void> }) {
  return (
    <NativeSelect size="sm" className="w-full max-w-56" value={value} onChange={(e) => onSave(e.target.value || null)}>
      {options.map((o) => <NativeSelectOption key={o} value={o}>{o || "—"}</NativeSelectOption>)}
    </NativeSelect>
  );
}

function SalaryField({ app, save }: { app: Application; save: (p: Patch) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(app));
  const text = fmtSalary(app);
  const read = readSalary(draft);

  if (!editing) {
    return (
      <button
        type="button"
        className={ghostField}
        onClick={() => {
          setDraft(draftFrom(app));
          setEditing(true);
        }}
      >
        {text ?? <span className="text-muted-foreground">Add yearly range</span>}
      </button>
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!read.patch) return;
    await save(read.patch);
    setEditing(false);
  }
  return (
    <form onSubmit={submit} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} className="space-y-2 rounded-lg border p-3">
      <SalaryInputs value={draft} onChange={setDraft} autoFocus />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!read.patch}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </form>
  );
}

// Same rule as the dashboard (stats.awaiting_reply): closed or on-hold processes need nothing
// from you, and any later event means the request was handled.
function awaitingReply(app: ApplicationDetail, e: TimelineEvent): boolean {
  if (!e.needs_reply || e.replied_at || CLOSED_STATUSES.has(app.status) || app.status === "on_hold") return false;
  return !app.events.some((other) => other.occurred_at > e.occurred_at);
}

function EventItem({ e, awaiting, onDone }: { e: TimelineEvent; awaiting: boolean; onDone: () => void }) {
  const manual = e.kind === "manual";
  const Icon = manual ? PenLine : Mail;
  return (
    <li className="relative">
      <span className="absolute top-0.5 -left-[1.9rem] grid size-5 place-items-center rounded-full border bg-background">
        <Icon className="size-3 text-muted-foreground" />
      </span>
      <div className="text-xs text-muted-foreground">
        {fmtDate(e.occurred_at, true)} · {manual ? "you" : e.from_name || e.from_address}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {e.event_type === "manual_stage_change" && e.stage_implied ? <>→ {STATUS_META[e.stage_implied].label}</> : label(e.event_type)}
        {e.round ? <span className="font-normal text-muted-foreground">round {e.round}</span> : null}
        {e.interview_at && <span className="font-normal text-muted-foreground">· {fmtDate(e.interview_at, true)}</span>}
        {awaiting && (
          <Button
            size="xs"
            variant="outline"
            className="border-amber-500/40 text-amber-700 dark:text-amber-300"
            onClick={async () => { await api.markReplied(e.id); toast.success("Marked as handled"); onDone(); }}
          >
            reply needed · mark done
          </Button>
        )}
      </div>
      {e.subject && <div className="text-sm">{e.subject}</div>}
      {e.summary && <div className="text-sm text-muted-foreground">{e.summary}</div>}
    </li>
  );
}

export function Field({ label: text, id, children, hint, tag }: { label: string; id?: string; children: ReactNode; hint?: string; tag?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{text}</Label>
        {tag && <span className="rounded bg-indigo-500/10 px-1.5 text-xs leading-5 text-indigo-700 dark:text-indigo-300">{tag}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DeleteButton({ app, onDeleted }: { app: Application; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirm(true)}>
        <Trash2 /> Delete application
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      Delete {app.company}? Its emails go back to the inbox.
      <Button
        variant="destructive"
        size="sm"
        onClick={async () => {
          await api.deleteApplication(app.id);
          toast.success(`Deleted ${app.company}`);
          onDeleted();
        }}
      >
        Yes, delete
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
    </div>
  );
}
