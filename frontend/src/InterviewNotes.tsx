import { useState, type FormEvent, type ReactNode } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  api, dateTimeToIso, dayToIso, errorText, fmtDate, isoToDateTime, isoToDay, label, relativeDay,
  type ApplicationDetail, type Interview, type Note,
} from "./api";
import { Field } from "./ApplicationView";

export const INTERVIEW_TYPES = ["recruiter", "technical", "system_design", "behavioral", "take_home", "onsite", "other"];
const SOURCE_ICON = { calendar: CalendarDays, email: Mail, manual: PenLine } as const;
const SOURCE_LABEL = { calendar: "From Google Calendar", email: "From an invite email", manual: "Added by hand" } as const;

type Filter = "all" | "general" | string; // string = an interview id

/** "silver.dev" for a general talk: who it was with, since there's no company. */
export function talkWith(iv: Pick<Interview, "organizer" | "attendees">): string | null {
  const addr = iv.organizer ?? iv.attendees.find((a) => !a.endsWith("@gmail.com")) ?? iv.attendees[0];
  return addr ? addr.split("@").pop()! : null;
}

export function interviewName(iv: Pick<Interview, "title" | "interview_type" | "round">): string {
  const base = iv.title || (iv.interview_type ? label(iv.interview_type) : "Interview");
  return iv.round && !/round/i.test(base) ? `${base} · round ${iv.round}` : base;
}

/** The application's interviews (calendar, invite emails, by hand), each with its own notes. */
export function InterviewsAndNotes({ app, onDone }: { app: ApplicationDetail; onDone: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState<"interview" | "note" | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // note id
  const ivs = [...app.interviews].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const byId = new Map(ivs.map((iv) => [iv.id, iv]));
  const general = app.interview_notes.filter((n) => !n.interview_id || !byId.has(n.interview_id));
  const notes =
    filter === "all" ? app.interview_notes : filter === "general" ? general : app.interview_notes.filter((n) => n.interview_id === filter);
  const selected = byId.get(filter);
  const done = () => { setAdding(null); setEditing(null); onDone(); };

  return (
    <div className="space-y-4">
      {ivs.length === 0 && adding !== "interview" ? (
        <p className="text-sm text-muted-foreground">
          No interviews yet. They show up from Google Calendar and invite emails, or add one by hand.
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Interviews">
          {ivs.map((iv) => (
            <InterviewRow key={iv.id} iv={iv} selected={filter === iv.id} onSelect={() => setFilter(filter === iv.id ? "all" : iv.id)} onDone={onDone} />
          ))}
        </ul>
      )}
      {adding === "interview" ? (
        <InterviewForm appId={app.id} round={(app.current_round ?? 0) + 1} onDone={done} onCancel={() => setAdding(null)} />
      ) : (
        <Button variant="ghost" size="xs" onClick={() => setAdding("interview")}><CalendarPlus /> Add interview by hand</Button>
      )}

      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show notes for">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All notes · {app.interview_notes.length}</FilterChip>
          {general.length > 0 && <FilterChip active={filter === "general"} onClick={() => setFilter("general")}>General · {general.length}</FilterChip>}
          {selected && <FilterChip active onClick={() => setFilter("all")}>{interviewName(selected)} · {notes.length} ✕</FilterChip>}
        </div>

        {notes.length === 0 && adding !== "note" && (
          <p className="text-sm text-muted-foreground">
            {selected ? (new Date(selected.starts_at) > new Date() ? "Nothing yet. Prep notes are welcome too." : "No notes for this interview yet.") : "No notes yet."}
          </p>
        )}
        {notes.map((n) =>
          editing === n.id ? (
            <NoteForm key={n.id} app={app} initial={n} interviewId={n.interview_id} onDone={done} onCancel={() => setEditing(null)} />
          ) : (
            <NoteCard key={n.id} n={n} iv={n.interview_id ? byId.get(n.interview_id) : undefined} showInterview={filter === "all"} onEdit={() => setEditing(n.id)} onDone={onDone} />
          ),
        )}
        {adding === "note" ? (
          <NoteForm app={app} interviewId={selected?.id ?? defaultInterview(ivs)?.id ?? null} onDone={done} onCancel={() => setAdding(null)} />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding("note")}>
            <NotebookPen /> {selected ? `Add note for ${interviewName(selected)}` : "Add note"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The interview a new note is most likely about: the latest one that already started. */
function defaultInterview(ivs: Interview[]): Interview | undefined {
  const now = new Date().toISOString();
  return [...ivs].reverse().find((iv) => iv.status === "scheduled" && iv.starts_at <= now);
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function InterviewRow({ iv, selected, onSelect, onDone }: { iv: Interview; selected: boolean; onSelect: () => void; onDone: () => void }) {
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
    <li className={cn("flex items-center gap-2 rounded-lg border p-1 pr-1.5 transition-colors", selected && "border-primary ring-2 ring-primary/20")}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
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

function NoteCard({ n, iv, showInterview, onEdit, onDone }: { n: Note; iv?: Interview; showInterview: boolean; onEdit: () => void; onDone: () => void }) {
  const heading = iv ? interviewName(iv) : n.round || n.interview_type ? interviewName({ title: null, interview_type: n.interview_type, round: n.round }) : "General";
  const when = iv?.starts_at ?? n.interview_at;
  return (
    <div className="space-y-1.5 rounded-lg border p-3 text-sm">
      <div className="flex items-center gap-2">
        {showInterview && <span className="font-medium">{heading}</span>}
        {when && <span className="text-muted-foreground">{fmtDate(when)}</span>}
        {n.self_rating ? <span className="text-amber-500" aria-label={`${n.self_rating} of 5`}>{"★".repeat(n.self_rating)}<span className="text-muted-foreground/40">{"★".repeat(5 - n.self_rating)}</span></span> : null}
        <div className="ml-auto flex">
          <Button variant="ghost" size="icon-xs" aria-label="Edit note" onClick={onEdit}><Pencil /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="Delete note" onClick={async () => { await api.deleteNote(n.id); onDone(); }}><Trash2 /></Button>
        </div>
      </div>
      {n.body && <p className="whitespace-pre-wrap">{n.body}</p>}
      {n.interviewers && <p><span className="font-medium">With:</span> {n.interviewers}</p>}
      {n.questions.length > 0 && <ul className="list-disc pl-5">{n.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
      {n.went_well && <p><span className="font-medium">Went well:</span> {n.went_well}</p>}
      {n.went_wrong && <p><span className="font-medium">Went wrong:</span> {n.went_wrong}</p>}
      {n.topics_to_study.length > 0 && <p><span className="font-medium">Study:</span> {n.topics_to_study.join(", ")}</p>}
    </div>
  );
}

function NoteForm({ app, initial, interviewId, onDone, onCancel }: { app: ApplicationDetail; initial?: Note; interviewId: string | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    interview_id: interviewId ?? "",
    body: initial?.body ?? "",
    interviewers: initial?.interviewers ?? "",
    round: initial?.round ? String(initial.round) : "",
    interview_at: isoToDay(initial?.interview_at ?? null),
    interview_type: initial?.interview_type ?? "",
    questions: initial?.questions.join("\n") ?? "",
    self_rating: initial?.self_rating ? String(initial.self_rating) : "",
    went_well: initial?.went_well ?? "",
    went_wrong: initial?.went_wrong ?? "",
    topics: initial?.topics_to_study.join(", ") ?? "",
  });
  const bind = (k: keyof typeof f) => ({ id: `note-${k}`, value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const iv = app.interviews.find((i) => i.id === f.interview_id);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const data: Partial<Note> = {
      interview_id: iv?.id ?? null,
      body: f.body.trim() || null,
      interviewers: f.interviewers.trim() || null,
      // Tied to an interview, the note takes its round, date and type from it.
      round: iv ? iv.round : f.round ? Number(f.round) : null,
      interview_at: iv ? iv.starts_at : f.interview_at ? dayToIso(f.interview_at) : null,
      interview_type: iv ? iv.interview_type : f.interview_type || null,
      questions: lines(f.questions),
      self_rating: f.self_rating ? Number(f.self_rating) : null,
      went_well: f.went_well.trim() || null,
      went_wrong: f.went_wrong.trim() || null,
      topics_to_study: f.topics.split(",").map((t) => t.trim()).filter(Boolean),
    };
    try {
      if (initial) await api.updateNote(initial.id, data);
      else await api.addNote(app.id, data);
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  return (
    <form className="space-y-3 rounded-lg border p-3" onSubmit={submit}>
      <Field label="Interview" id="note-interview_id">
        <NativeSelect className="w-full" {...bind("interview_id")}>
          <NativeSelectOption value="">General: not about one interview</NativeSelectOption>
          {app.interviews.map((i) => (
            <NativeSelectOption key={i.id} value={i.id}>{fmtDate(i.starts_at)} · {interviewName(i)}</NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {!iv && (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Round" id="note-round"><Input type="number" min={1} {...bind("round")} /></Field>
          <Field label="Date" id="note-interview_at"><Input type="date" {...bind("interview_at")} /></Field>
          <Field label="Type" id="note-interview_type">
            <NativeSelect className="w-full" {...bind("interview_type")}>
              <NativeSelectOption value="">—</NativeSelectOption>
              {INTERVIEW_TYPES.map((t) => <NativeSelectOption key={t} value={t}>{label(t)}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        </div>
      )}
      <Field label="Notes" id="note-body"><Textarea rows={5} autoFocus placeholder="How it went, what they asked, what to follow up on…" {...bind("body")} /></Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field label="Interviewers" id="note-interviewers"><Input placeholder="Jane (EM), Bob (Staff)" {...bind("interviewers")} /></Field>
        <Field label="Self-rating (1–5)" id="note-self_rating"><Input type="number" min={1} max={5} {...bind("self_rating")} /></Field>
      </div>
      <Field label="Questions asked (one per line)" id="note-questions"><Textarea rows={3} {...bind("questions")} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What went well" id="note-went_well"><Textarea rows={2} {...bind("went_well")} /></Field>
        <Field label="What went wrong" id="note-went_wrong"><Textarea rows={2} {...bind("went_wrong")} /></Field>
      </div>
      <Field label="Topics to study (comma separated)" id="note-topics"><Input {...bind("topics")} /></Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm">{initial ? "Save note" : "Add note"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
