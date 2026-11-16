import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { type Note } from "@/api/interviews";
import { Loading } from "@/components/common";
import { AppLink } from "./AppLink";
import { EditorHeader } from "./EditorHeader";
import { NoteDoc } from "./NoteDoc";

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
      <EditorHeader
        eyebrow={<><PenLine className="size-3.5" /><AppLink appId={ctx.appId} company={ctx.company} role={ctx.role} /></>}
        title="General note"
        sub={<span>About the process as a whole, not one interview</span>}
        page={inDialog && noteId ? `/notes/${noteId}` : null}
      />
      <NoteDoc appId={ctx.appId} interview={null} note={ctx.note} onSaved={(n) => setSavedId(n.id)} />
    </>
  );
}
