import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
  ArrowLeft, Bold, CalendarDays, Code, ExternalLink, Heading2, Italic, List, ListChecks, ListOrdered, Mail, Maximize2,
  MessagesSquare, MoreHorizontal, PenLine, Plus, Quote, Star, Trash2, Video,
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, errorText, fmtDate, relativeDay, type Interview, type InterviewDetail, type Note } from "./api";
import { Field } from "./ApplicationView";
import { Loading } from "./components/common";
import { interviewName, talkWith, TypePicker } from "./InterviewNotes";
import { useRefresh } from "./lib/refresh";

// The notes editor: a dialog over any page (?interview=<id>, ?note=<id>, ?note=new:<application id>)
// and a page of its own (/interviews/:id, /notes/:id), like an application's sheet and page.
// Notes are Markdown; every change autosaves.

const SOURCE_ICON = { calendar: CalendarDays, email: Mail, manual: PenLine } as const;

/** Opens the editor over the current page, keeping the rest of the URL (an open sheet, filters). */
export function useOpenEditor() {
  const [params, setParams] = useSearchParams();
  return (kind: "interview" | "note", id: string) => {
    const next = new URLSearchParams(params);
    next.delete("interview");
    next.delete("note");
    next.set(kind, id);
    setParams(next, { replace: true });
  };
}

/** Plain text from a note's Markdown, for one-line previews. */
export function plainText(md: string | null | undefined): string {
  return (md ?? "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Saves still running, so whoever closes the editor can refresh after they land.
const inflight = new Set<Promise<void>>();
const settled = () => Promise.all([...inflight]);

type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Debounced saves, one at a time, in order; whatever is pending is saved on unmount. */
function useAutosave<T>(save: (value: T) => Promise<void>, delay = 700) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<{ value: T } | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const pending = latest.current;
    if (!pending) return;
    latest.current = null;
    setStatus("saving");
    const p = chain.current
      .then(() => saveRef.current(pending.value))
      .then(() => setStatus((s) => (latest.current ? s : "saved")))
      .catch((e) => {
        setStatus("error");
        toast.error(`Notes not saved: ${errorText(e)}`);
      });
    chain.current = p;
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  }, []);

  const schedule = useCallback((value: T) => {
    latest.current = { value };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  }, [flush, delay]);

  useEffect(() => () => flush(), [flush]);
  return { status, schedule };
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved" }[status];
  return (
    <span aria-live="polite" className={cn("text-xs tabular-nums text-muted-foreground", status === "error" && "text-destructive")}>
      {text}
    </span>
  );
}

/** Markdown in, Markdown out. Shortcuts work too: "## ", "- ", "[ ] ", **bold**. */
export function RichEditor({ initial, onChange, placeholder, autoFocus = false }: {
  initial: string;
  onChange: (markdown: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      Placeholder.configure({ placeholder }),
    ],
    content: initial,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    editorProps: { attributes: { class: "notes-doc", "aria-label": "Notes", "aria-multiline": "true", role: "textbox" } },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getMarkdown()),
  });
  return (
    <div className="flex min-h-0 flex-col">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="min-h-0 flex-1" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("code"),
    }),
  });
  const run = () => editor.chain().focus();
  const tools: { key: keyof typeof on; icon: typeof Bold; label: string; act: () => void }[] = [
    { key: "h2", icon: Heading2, label: "Heading", act: () => run().toggleHeading({ level: 2 }).run() },
    { key: "bold", icon: Bold, label: "Bold", act: () => run().toggleBold().run() },
    { key: "italic", icon: Italic, label: "Italic", act: () => run().toggleItalic().run() },
    { key: "bullet", icon: List, label: "Bullet list", act: () => run().toggleBulletList().run() },
    { key: "ordered", icon: ListOrdered, label: "Numbered list", act: () => run().toggleOrderedList().run() },
    { key: "task", icon: ListChecks, label: "Checklist", act: () => run().toggleTaskList().run() },
    { key: "quote", icon: Quote, label: "Quote", act: () => run().toggleBlockquote().run() },
    { key: "code", icon: Code, label: "Code", act: () => run().toggleCode().run() },
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap gap-0.5 bg-background/90 py-1 backdrop-blur">
      {tools.map(({ key, icon: Icon, label: text, act }) => (
        <Button
          key={key}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={text}
          title={text}
          aria-pressed={on[key]}
          className={cn(on[key] && "bg-muted text-foreground")}
          onMouseDown={(e) => e.preventDefault()} // keep the selection
          onClick={act}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );
}

// ---- one note: the document plus the structured bits the study report will read ----

interface Draft {
  body: string;
  interviewers: string;
  self_rating: number | null;
  questions: string;
  went_well: string;
  went_wrong: string;
  topics: string;
}

const draftOf = (n: Note | null): Draft => ({
  body: n?.body ?? "",
  interviewers: n?.interviewers ?? "",
  self_rating: n?.self_rating ?? null,
  questions: n?.questions.join("\n") ?? "",
  went_well: n?.went_well ?? "",
  went_wrong: n?.went_wrong ?? "",
  topics: n?.topics_to_study.join(", ") ?? "",
});

const isEmpty = (d: Draft) =>
  !d.self_rating && ![d.body, d.interviewers, d.questions, d.went_well, d.went_wrong, d.topics].some((v) => v.trim());

function NoteDoc({ appId, interview, note, onSaved }: {
  appId: string;
  interview: Interview | null;
  note: Note | null;
  onSaved: (n: Note) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(note));
  const draftRef = useRef(draft);
  const noteId = useRef(note?.id ?? null);
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  const { status, schedule } = useAutosave(async (d: Draft) => {
    const data: Partial<Note> = {
      interview_id: interview?.id ?? null,
      body: d.body.trim() || null,
      interviewers: d.interviewers.trim() || null,
      // Tied to an interview, the note takes its round, date and type from it.
      round: interview ? interview.round : note?.round ?? null,
      interview_at: interview ? interview.starts_at : note?.interview_at ?? null,
      interview_type: interview ? interview.interview_type : note?.interview_type ?? null,
      questions: lines(d.questions),
      self_rating: d.self_rating,
      went_well: d.went_well.trim() || null,
      went_wrong: d.went_wrong.trim() || null,
      topics_to_study: d.topics.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (noteId.current) {
      onSaved(await api.updateNote(noteId.current, data));
    } else if (!isEmpty(d)) {
      const created = await api.addNote(appId, data);
      noteId.current = created.id;
      onSaved(created);
    }
  });

  const change = (patch: Partial<Draft>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    schedule(next);
  };
  const bind = (k: "interviewers" | "questions" | "went_well" | "went_wrong" | "topics") => ({
    id: `doc-${k}`,
    value: draft[k],
    onChange: (e: { target: { value: string } }) => change({ [k]: e.target.value }),
  });
  const upcoming = interview ? new Date(interview.starts_at) > new Date() : false;
  const topics = draft.topics.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="relative min-h-0 overflow-y-auto px-6 py-4">
        <div className="absolute top-5 right-6"><SaveIndicator status={status} /></div>
        <RichEditor
          initial={draft.body}
          autoFocus
          onChange={(md) => change({ body: md })}
          placeholder={upcoming ? "Prep: what to ask, what to brush up on, who you're meeting…" : "How it went, what they asked, what to follow up on…"}
        />
      </div>
      <aside className="space-y-4 overflow-y-auto border-t bg-muted/30 px-5 py-4 md:border-t-0 md:border-l" aria-label="Details">
        <div className="space-y-1.5">
          <span className="text-sm font-medium">How it went</span>
          <div className="flex gap-0.5" role="radiogroup" aria-label="Self-rating">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={draft.self_rating === v}
                aria-label={`${v} of 5`}
                onClick={() => change({ self_rating: draft.self_rating === v ? null : v })}
                className="rounded p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Star className={cn("size-5 transition-colors", draft.self_rating && v <= draft.self_rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400")} />
              </button>
            ))}
          </div>
        </div>
        <Field label="Interviewers" id="doc-interviewers"><Input placeholder="Jane (EM), Bob (Staff)" {...bind("interviewers")} /></Field>
        <Field label="Topics to study" id="doc-topics" hint="Comma separated">
          <Input placeholder="sql indexes, k8s networking" {...bind("topics")} />
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">{topics.map((t) => <span key={t} className="rounded bg-indigo-500/10 px-1.5 text-xs leading-5 text-indigo-700 dark:text-indigo-300">{t}</span>)}</div>
          )}
        </Field>
        <Field label="Questions asked" id="doc-questions" hint="One per line"><Textarea rows={4} {...bind("questions")} /></Field>
        <Field label="What went well" id="doc-went_well"><Textarea rows={2} {...bind("went_well")} /></Field>
        <Field label="What went wrong" id="doc-went_wrong"><Textarea rows={2} {...bind("went_wrong")} /></Field>
      </aside>
    </div>
  );
}

/** A general talk (recruiter, agency): its notes are inline text on the interview. */
function TalkDoc({ iv }: { iv: Interview }) {
  const { status, schedule } = useAutosave(async (md: string) => {
    await api.updateInterview(iv.id, { notes: md.trim() || null });
  });
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="absolute top-5 right-6"><SaveIndicator status={status} /></div>
      <RichEditor initial={iv.notes ?? ""} autoFocus onChange={schedule} placeholder="Which roles and companies came up, what they need from you, next steps…" />
    </div>
  );
}

// ---- headers and the two entry points ----

function Header({ eyebrow, title, sub, actions, page }: { eyebrow: ReactNode; title: string; sub?: ReactNode; actions?: ReactNode; page: string | null }) {
  return (
    <header className="flex flex-wrap items-start gap-3 border-b pt-5 pr-14 pb-4 pl-6">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{eyebrow}</div>
        <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
        {sub && <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">{sub}</div>}
      </div>
      <div className="flex items-center gap-1">
        {actions}
        {page && (
          <Button asChild variant="ghost" size="xs"><Link to={page}><Maximize2 /> Open page</Link></Button>
        )}
      </div>
    </header>
  );
}

function AppLink({ appId, company, role }: { appId: string | null; company: string | null; role: string | null }) {
  const text = [company, role].filter(Boolean).join(" · ");
  return appId ? <Link to={`/applications/${appId}`} className="truncate hover:text-foreground hover:underline">{text}</Link> : <span>{text}</span>;
}

type Slot = { key: string; note: Note | null };

export function InterviewEditor({ id, inDialog = false }: { id: string; inDialog?: boolean }) {
  const [iv, setIv] = useState<InterviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [active, setActive] = useState("");

  // Loaded once: a refresh while typing would reset the editor.
  useEffect(() => {
    api.interview(id).then((d) => {
      const s = d.notes_list.length ? d.notes_list.map((n) => ({ key: n.id, note: n })) : [{ key: "new-0", note: null }];
      setIv(d);
      setSlots(s);
      setActive(s[0].key);
    }).catch((e) => setError(errorText(e)));
  }, [id]);

  if (!iv) return <div className="p-6"><Loading error={error} loading={!error} /></div>;
  const Icon = SOURCE_ICON[iv.source];
  const upcoming = new Date(iv.starts_at) > new Date();
  const page = inDialog ? `/interviews/${iv.id}` : null;
  const when = <><span className="tabular-nums">{fmtDate(iv.starts_at, true)}</span><span>· {relativeDay(iv.starts_at)}</span></>;
  const actions = (
    <>
      {upcoming && iv.meeting_url && (
        <Button asChild variant="outline" size="xs"><a href={iv.meeting_url} target="_blank" rel="noreferrer"><Video /> Join</a></Button>
      )}
      {iv.html_link && (
        <Button asChild variant="ghost" size="icon-xs" aria-label="Open in Google Calendar" title="Open in Google Calendar"><a href={iv.html_link} target="_blank" rel="noreferrer"><ExternalLink /></a></Button>
      )}
    </>
  );

  if (iv.general || !iv.application_id) {
    return (
      <>
        <Header
          eyebrow={<><MessagesSquare className="size-3.5" /> General talk{talkWith(iv) ? ` · ${talkWith(iv)}` : ""}</>}
          title={interviewName(iv)}
          sub={when}
          actions={actions}
          page={page}
        />
        <TalkDoc iv={iv} />
      </>
    );
  }

  const removeActive = async () => {
    const slot = slots.find((s) => s.key === active);
    if (!slot?.note) return;
    try {
      await api.deleteNote(slot.note.id);
      const rest = slots.filter((s) => s.key !== active);
      const next = rest.length ? rest : [{ key: `new-${Date.now()}`, note: null }];
      setSlots(next);
      setActive(next[0].key);
      toast.success("Note deleted");
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  const addSlot = () => {
    const key = `new-${Date.now()}`;
    setSlots([...slots, { key, note: null }]);
    setActive(key);
  };
  const current = slots.find((s) => s.key === active) ?? slots[0];

  return (
    <>
      <Header
        eyebrow={<><Icon className="size-3.5 shrink-0" /><AppLink appId={iv.application_id} company={iv.company} role={iv.role} /></>}
        title={interviewName(iv)}
        sub={<>{when}<span>·</span><TypePicker key={iv.id} id={iv.id} value={iv.interview_type} onSaved={(t) => setIv({ ...iv, interview_type: t })} /></>}
        actions={
          <>
            {actions}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Note actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={addSlot}><Plus /> Add another note</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" disabled={!current?.note} onSelect={removeActive}><Trash2 /> Delete this note</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        page={page}
      />
      {slots.length > 1 && (
        <div className="flex gap-1 border-b px-6 py-1.5" role="tablist" aria-label="Notes">
          {slots.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s.key === current.key}
              onClick={() => setActive(s.key)}
              className={cn("rounded-full px-2.5 py-0.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50", s.key === current.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              Note {i + 1}
            </button>
          ))}
        </div>
      )}
      {current && (
        <NoteDoc
          key={current.key}
          appId={iv.application_id}
          interview={iv}
          note={current.note}
          onSaved={(n) => setSlots((all) => all.map((s) => (s.key === current.key ? { ...s, note: n } : s)))}
        />
      )}
    </>
  );
}

/** A note about the process as a whole (no interview). `new:<application id>` starts one. */
export function NoteEditor({ id, inDialog = false }: { id: string; inDialog?: boolean }) {
  const isNew = id.startsWith("new:");
  const [ctx, setCtx] = useState<{ appId: string; company: string | null; role: string | null; note: Note | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    const load = isNew
      ? api.application(id.slice(4)).then((a) => ({ appId: a.id, company: a.company, role: a.role_title, note: null }))
      : api.note(id).then((n) => ({ appId: n.application_id, company: n.company, role: n.role, note: n as Note }));
    load.then(setCtx).catch((e) => setError(errorText(e)));
  }, [id, isNew]);

  if (!ctx) return <div className="p-6"><Loading error={error} loading={!error} /></div>;
  const noteId = savedId ?? ctx.note?.id ?? null;
  return (
    <>
      <Header
        eyebrow={<><PenLine className="size-3.5" /><AppLink appId={ctx.appId} company={ctx.company} role={ctx.role} /></>}
        title="General note"
        sub={<span>About the process as a whole, not one interview</span>}
        page={inDialog && noteId ? `/notes/${noteId}` : null}
      />
      <NoteDoc appId={ctx.appId} interview={null} note={ctx.note} onSaved={(n) => setSavedId(n.id)} />
    </>
  );
}

/** Mounted once in the layout: the editor over whatever page is open. */
export function EditorDialog() {
  const [params, setParams] = useSearchParams();
  const { bump } = useRefresh();
  const interview = params.get("interview");
  const note = params.get("note");

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("interview");
    next.delete("note");
    setParams(next, { replace: true });
    // After the editor unmounts and its last save lands, refresh what's underneath.
    window.setTimeout(() => void settled().then(bump), 0);
  };

  return (
    <Dialog open={!!(interview || note)} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[min(54rem,92svh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogTitle className="sr-only">Notes</DialogTitle>
        {interview ? <InterviewEditor key={interview} id={interview} inDialog /> : note ? <NoteEditor key={note} id={note} inDialog /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** /interviews/:id and /notes/:id */
export function EditorPage({ kind }: { kind: "interview" | "note" }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { bump } = useRefresh();
  return (
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" className="-ml-2 mb-4" onClick={() => { void settled().then(bump); navigate(-1); }}>
        <ArrowLeft /> Back
      </Button>
      <div className="flex h-[calc(100svh-8rem)] flex-col overflow-hidden rounded-xl border bg-background">
        {kind === "interview" ? <InterviewEditor key={id} id={id} /> : <NoteEditor key={id} id={id} />}
      </div>
    </div>
  );
}
