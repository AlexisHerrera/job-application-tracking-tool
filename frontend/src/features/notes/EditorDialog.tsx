import { useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRefresh } from "@/lib/refresh";
import { InterviewEditor } from "./InterviewEditor";
import { NoteEditor } from "./NoteEditor";
import { settled } from "./useAutosave";

// The notes editor: a dialog over any page (?interview=<id>, ?note=<id>, ?note=new:<application id>)
// and a page of its own (/interviews/:id, /notes/:id), like an application's sheet and page.
// Notes are Markdown; every change autosaves.

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
