import { useState } from "react";
import { CalendarPlus, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApplicationDetail } from "@/api/applications";
import { plainText } from "@/lib/notes";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { InterviewForm } from "./InterviewForm";
import { InterviewRow } from "./InterviewRow";
import { NoteCard } from "./NoteCard";

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
