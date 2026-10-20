import { useState } from "react";
import { CalendarDays, ChevronRight, Mail, MessagesSquare, NotebookPen, PenLine, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, fmtDate, label, relativeDay, type Interview } from "../api";
import { Empty, Loading, PageHeader } from "../components/common";
import { interviewName, talkWith } from "../InterviewNotes";
import { useRefresh } from "../lib/refresh";
import { useAsync } from "../useAsync";

const SOURCE_ICON = { calendar: CalendarDays, email: Mail, manual: PenLine } as const;

/** Every interview in one list: what's next, what just happened, and general recruiter talks. */
export default function Interviews() {
  const { data, error, loading } = useAsync(api.interviews);
  if (!data) return <Loading error={error} loading={loading} rows={5} />;
  const now = new Date().toISOString();
  const upcoming = data.filter((iv) => iv.starts_at >= now);
  const past = data.filter((iv) => iv.starts_at < now).reverse();
  const done = past.filter((iv) => !iv.general).length;
  const general = data.filter((iv) => iv.general).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Interviews"
        description={`${done} done · ${upcoming.filter((iv) => !iv.general).length} upcoming${general ? ` · plus ${general} general talk${general === 1 ? "" : "s"}` : ""}. From Google Calendar, invite emails, and the ones you added.`}
      />
      {data.length === 0 ? (
        <Empty icon={<CalendarDays className="size-8" />}>No interviews yet.</Empty>
      ) : (
        <div className="space-y-6">
          <Group title="Upcoming" items={upcoming} empty="Nothing scheduled." />
          <Group title="Past" items={past} empty="None yet." />
        </div>
      )}
    </div>
  );
}

function Group({ title, items, empty }: { title: string; items: Interview[]; empty: string }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-sm font-medium">{title} · {items.length}</h2>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {items.map((iv) => (iv.general ? <GeneralRow key={iv.id} iv={iv} /> : <InterviewLink key={iv.id} iv={iv} />))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function When({ iv }: { iv: Interview }) {
  return (
    <div className="w-28 shrink-0">
      <div className="text-sm font-medium tabular-nums">{fmtDate(iv.starts_at, true).replace(/ \d{4},/, ",")}</div>
      <div className="text-xs text-muted-foreground">{relativeDay(iv.starts_at)}</div>
    </div>
  );
}

function NotesBadge({ iv }: { iv: Interview }) {
  const past = new Date(iv.starts_at) < new Date();
  if (iv.notes_count > 0) {
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label={`${iv.notes_count} notes`}><NotebookPen className="size-3.5" />{iv.notes_count}</span>;
  }
  return past ? <span className="rounded-full bg-amber-500/10 px-2 text-xs leading-5 text-amber-800 dark:text-amber-300">no notes</span> : null;
}

function InterviewLink({ iv }: { iv: Interview }) {
  const Icon = SOURCE_ICON[iv.source];
  return (
    <Link to={`/applications?open=${iv.application_id}`} className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
      <When iv={iv} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium group-hover:underline">{iv.company}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{interviewName(iv)}{iv.interview_type && !iv.title?.toLowerCase().includes(label(iv.interview_type)) ? ` · ${label(iv.interview_type)}` : ""}</span>
        </div>
      </div>
      <NotesBadge iv={iv} />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** A talk with a recruiter or agency: no application to open, so its notes edit right here. */
function GeneralRow({ iv }: { iv: Interview }) {
  const { bump } = useRefresh();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(iv.notes ?? "");
  const upcoming = new Date(iv.starts_at) > new Date();

  async function save() {
    try {
      await api.updateInterview(iv.id, { notes: text.trim() || null });
      toast.success("Notes saved");
      setOpen(false);
      bump();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <When iv={iv} />
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">General talk{talkWith(iv) ? ` · ${talkWith(iv)}` : ""}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{interviewName(iv)} · not tied to an application</div>
        </button>
        {upcoming && iv.meeting_url && (
          <Button asChild variant="ghost" size="icon-xs" aria-label="Join the call"><a href={iv.meeting_url} target="_blank" rel="noreferrer"><Video /></a></Button>
        )}
        <NotesBadge iv={iv} />
      </div>
      {!open && iv.notes && (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 block w-full whitespace-pre-wrap rounded-md text-left text-sm text-muted-foreground hover:text-foreground sm:pl-31">
          {iv.notes}
        </button>
      )}
      {open && (
        <div className="mt-3 space-y-2 sm:pl-31">
          <Textarea
            rows={5}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Which roles and companies came up, what they need from you, next steps…"
            aria-label="Notes for this talk"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>Save notes</Button>
            <Button size="sm" variant="ghost" onClick={() => { setText(iv.notes ?? ""); setOpen(false); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
