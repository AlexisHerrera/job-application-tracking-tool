import { useState, type FormEvent } from "react";
import {
  CalendarDays, CalendarPlus, ExternalLink, Mail, MoreHorizontal, NotebookPen, PenLine, Pencil, Trash2, Video,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import {
  api, dateTimeToIso, errorText, fmtDate, isoToDateTime, label, relativeDay,
  type ApplicationDetail, type Interview, type Note,
} from "./api";
import { Field } from "./ApplicationView";
import { plainText, useOpenEditor } from "./NotesEditor";

export const INTERVIEW_TYPES = ["recruiter", "technical", "system_design", "behavioral", "take_home", "onsite", "other"];
const SOURCE_ICON = { calendar: CalendarDays, email: Mail, manual: PenLine } as const;
const SOURCE_LABEL = { calendar: "From Google Calendar", email: "From an invite email", manual: "Added by hand" } as const;

/** "silver.dev" for a general talk: who it was with, since there's no company. */
export function talkWith(iv: Pick<Interview, "organizer" | "attendees">): string | null {
  const addr = iv.organizer ?? iv.attendees.find((a) => !a.endsWith("@gmail.com")) ?? iv.attendees[0];
  return addr ? addr.split("@").pop()! : null;
}

export function interviewName(iv: Pick<Interview, "title" | "interview_type" | "round">): string {
  const base = iv.title || (iv.interview_type ? label(iv.interview_type) : "Interview");
  return iv.round && !/round/i.test(base) ? `${base} · round ${iv.round}` : base;
}

/** The application's interviews (calendar, invite emails, by hand) and its general notes. Each
 * opens in the notes editor. */
export function InterviewsAndNotes({ app, onDone }: { app: ApplicationDetail; onDone: () => void }) {
  const openEditor = useOpenEditor();
  const [adding, setAdding] = useState(false);
  const ivs = [...app.interviews].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const ids = new Set(ivs.map((iv) => iv.id));
  const general = app.interview_notes.filter((n) => !n.interview_id || !ids.has(n.interview_id));
  const firstNote = (ivId: string) => app.interview_notes.find((n) => n.interview_id === ivId);

  return (
    <div className="space-y-4">
      {ivs.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">
          No interviews yet. They show up from Google Calendar and invite emails, or add one by hand.
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Interviews">
          {ivs.map((iv) => (
            <InterviewRow key={iv.id} iv={iv} preview={plainText(firstNote(iv.id)?.body)} onOpen={() => openEditor("interview", iv.id)} onDone={onDone} />
          ))}
        </ul>
      )}
      {adding ? (
        <InterviewForm appId={app.id} round={(app.current_round ?? 0) + 1} onDone={() => { setAdding(false); onDone(); }} onCancel={() => setAdding(false)} />
      ) : (
        <Button variant="ghost" size="xs" onClick={() => setAdding(true)}><CalendarPlus /> Add interview by hand</Button>
      )}

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">General notes · {general.length}</h4>
          <Button variant="outline" size="xs" onClick={() => openEditor("note", `new:${app.id}`)}><NotebookPen /> New note</Button>
        </div>
        {general.length === 0 ? (
          <p className="text-sm text-muted-foreground">About the process as a whole: salary talk, red flags, questions to ask them.</p>
        ) : (
          general.map((n) => <NoteCard key={n.id} n={n} onOpen={() => openEditor("note", n.id)} />)
        )}
      </div>
    </div>
  );
}

function InterviewRow({ iv, preview, onOpen, onDone }: { iv: Interview; preview: string; onOpen: () => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const Icon = SOURCE_ICON[iv.source];
  const upcoming = new Date(iv.starts_at) > new Date();
  const cancelled = iv.status === "cancelled";
  if (editing) return <li><InterviewForm initial={iv} onDone={() => { setEditing(false); onDone(); }} onCancel={() => setEditing(false)} /></li>;

  async function remove() {
    try {
      await api.removeInterview(iv.id);
      toast.success(iv.source === "manual" ? "Interview deleted" : "Hidden. It won't come back on the next sync.");
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-lg border p-1 pr-1.5 transition-colors">
      <button type="button" onClick={onOpen} aria-label={`Notes for ${interviewName(iv)}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
        <div className={cn("w-16 shrink-0 text-center", cancelled && "opacity-50")}>
          <div className="text-xs text-muted-foreground">{fmtDate(iv.starts_at).slice(0, 6)}</div>
          <div className="text-sm font-medium tabular-nums">{fmtDate(iv.starts_at, true).slice(-5)}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-medium", cancelled && "text-muted-foreground line-through")}>{interviewName(iv)}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5 shrink-0" aria-label={SOURCE_LABEL[iv.source]} />
            <span>{cancelled ? "cancelled" : relativeDay(iv.starts_at)}</span>
            {iv.interview_type && <span>· {label(iv.interview_type)}</span>}
          </div>
          {preview && <div className="truncate pt-0.5 text-xs text-muted-foreground/80">{preview}</div>}
        </div>
        {upcoming && !cancelled && <span className="rounded-full bg-violet-500/10 px-2 text-xs leading-5 text-violet-700 dark:text-violet-300">upcoming</span>}
        {iv.notes_count > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label={`${iv.notes_count} notes`}><NotebookPen className="size-3.5" />{iv.notes_count}</span>
        ) : !upcoming && !cancelled ? (
          <span className="rounded-full bg-amber-500/10 px-2 text-xs leading-5 text-amber-800 dark:text-amber-300">no notes</span>
        ) : null}
      </button>
      {upcoming && iv.meeting_url && !cancelled && (
        <Button asChild variant="ghost" size="icon-xs" aria-label="Join the call"><a href={iv.meeting_url} target="_blank" rel="noreferrer"><Video /></a></Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="Interview actions"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> Edit round, type, title</DropdownMenuItem>
          {iv.html_link && (
            <DropdownMenuItem asChild><a href={iv.html_link} target="_blank" rel="noreferrer"><ExternalLink /> Open in Google Calendar</a></DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={remove}>
            <Trash2 /> {iv.source === "manual" ? "Delete" : "Not an interview: hide"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function InterviewForm({ appId, initial, round, onDone, onCancel }: { appId?: string; initial?: Interview; round?: number; onDone: () => void; onCancel: () => void }) {
  const fromCalendar = initial?.source === "calendar"; // the calendar owns its time and title
  const [f, setF] = useState({
    starts_at: isoToDateTime(initial?.starts_at ?? null),
    title: initial?.title ?? "",
    interview_type: initial?.interview_type ?? "",
    round: initial?.round ? String(initial.round) : round ? String(round) : "",
  });
  const bind = (k: keyof typeof f) => ({ id: `iv-${k}`, value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const data = {
      ...(fromCalendar ? {} : { starts_at: f.starts_at ? dateTimeToIso(f.starts_at) : undefined, title: f.title || null }),
      interview_type: f.interview_type || null,
      round: f.round ? Number(f.round) : null,
    };
    try {
      if (initial) await api.updateInterview(initial.id, data);
      else await api.addInterview(appId!, data);
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    }
  }
  return (
    <form className="space-y-3 rounded-lg border p-3" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {!fromCalendar && (
          <>
            <Field label="When" id="iv-starts_at"><Input type="datetime-local" required {...bind("starts_at")} /></Field>
            <Field label="Title" id="iv-title"><Input placeholder="Phone screen" {...bind("title")} /></Field>
          </>
        )}
        <Field label="Type" id="iv-interview_type">
          <NativeSelect className="w-full" {...bind("interview_type")}>
            <NativeSelectOption value="">—</NativeSelectOption>
            {INTERVIEW_TYPES.map((t) => <NativeSelectOption key={t} value={t}>{label(t)}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field label="Round" id="iv-round"><Input type="number" min={1} max={20} {...bind("round")} /></Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">{initial ? "Save" : "Add interview"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function NoteCard({ n, onOpen }: { n: Note; onOpen: () => void }) {
  const heading = n.round || n.interview_type ? interviewName({ title: null, interview_type: n.interview_type, round: n.round }) : "General";
  const preview = plainText(n.body) || [n.went_well, n.went_wrong, n.questions.join(" · ")].filter(Boolean).join(" · ");
  return (
    <button type="button" onClick={onOpen} className="block w-full space-y-0.5 rounded-lg border p-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
      <div className="flex items-center gap-2">
        <span className="font-medium">{heading}</span>
        {n.interview_at && <span className="text-muted-foreground">{fmtDate(n.interview_at)}</span>}
        {n.self_rating ? <span className="text-amber-500" aria-label={`${n.self_rating} of 5`}>{"★".repeat(n.self_rating)}<span className="text-muted-foreground/40">{"★".repeat(5 - n.self_rating)}</span></span> : null}
      </div>
      <p className="line-clamp-2 text-muted-foreground">{preview || "Empty note"}</p>
    </button>
  );
}
