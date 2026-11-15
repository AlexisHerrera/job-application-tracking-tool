import { useRef, useState } from "react";
import { api, type Interview, type Note } from "@/api";
import { draftOf, isEmpty, noteData, type Draft } from "./draft";
import { NoteDetailsPanel } from "./NoteDetailsPanel";
import { RichEditor } from "./RichEditor/RichEditor";
import { SaveIndicator } from "./SaveIndicator";
import { useAutosave } from "./useAutosave";

export function NoteDoc({ appId, interview, note, onSaved }: {
  appId: string;
  interview: Interview | null;
  note: Note | null;
  onSaved: (n: Note) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(note));
  const draftRef = useRef(draft);
  const noteId = useRef(note?.id ?? null);

  const { status, schedule } = useAutosave(async (d: Draft) => {
    const data = noteData(d, interview, note);
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
  const upcoming = interview ? new Date(interview.starts_at) > new Date() : false;

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
      <NoteDetailsPanel draft={draft} change={change} />
    </div>
  );
}
