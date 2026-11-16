import { ChevronRight } from "lucide-react";
import { label } from "@/lib/format";
import { type Interview } from "@/api/interviews";
import { SOURCE_ICON, interviewName } from "@/lib/interviews";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { InterviewWhen } from "./InterviewWhen";
import { NotesBadge } from "./NotesBadge";

export function InterviewLink({ iv }: { iv: Interview }) {
  const openEditor = useOpenEditor();
  const Icon = SOURCE_ICON[iv.source];
  return (
    <button type="button" onClick={() => openEditor("interview", iv.id)} className="group flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
      <InterviewWhen iv={iv} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium group-hover:underline">{iv.company}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{interviewName(iv)}{iv.interview_type && !iv.title?.toLowerCase().includes(label(iv.interview_type)) ? ` · ${label(iv.interview_type)}` : ""}</span>
        </div>
      </div>
      <NotesBadge iv={iv} />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
