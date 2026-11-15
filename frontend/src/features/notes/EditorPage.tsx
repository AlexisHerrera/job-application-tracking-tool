import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useRefresh } from "@/lib/refresh";
import { InterviewEditor } from "./InterviewEditor";
import { NoteEditor } from "./NoteEditor";
import { settled } from "./useAutosave";

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
