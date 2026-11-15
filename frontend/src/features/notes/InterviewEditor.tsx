import { useEffect, useState } from "react";
import { ExternalLink, MessagesSquare, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorText, fmtDate, relativeDay, type InterviewDetail, type Note } from "@/api";
import { TypePicker } from "@/features/interviews/TypePicker";
import { SOURCE_ICON, interviewName, talkWith } from "@/lib/interviews";
import { Loading } from "@/components/common";
import { AppLink } from "./AppLink";
import { EditorHeader } from "./EditorHeader";
import { NoteActionsMenu } from "./NoteActionsMenu";
import { NoteDoc } from "./NoteDoc";
import { NoteTabs } from "./NoteTabs";
import { TalkDoc } from "./TalkDoc";

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
        <EditorHeader
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
      <EditorHeader
        eyebrow={<><Icon className="size-3.5 shrink-0" /><AppLink appId={iv.application_id} company={iv.company} role={iv.role} /></>}
        title={interviewName(iv)}
        sub={<>{when}<span>·</span><TypePicker key={iv.id} id={iv.id} value={iv.interview_type} onSaved={(t) => setIv({ ...iv, interview_type: t })} /></>}
        actions={
          <>
            {actions}
            <NoteActionsMenu onAdd={addSlot} onDelete={removeActive} canDelete={!!current?.note} />
          </>
        }
        page={page}
      />
      {slots.length > 1 && <NoteTabs slots={slots} active={current.key} onSelect={setActive} />}
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
