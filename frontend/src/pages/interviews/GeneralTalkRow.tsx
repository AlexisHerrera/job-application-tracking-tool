import { ChevronRight, MessagesSquare, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Interview } from "@/api";
import { interviewName, talkWith } from "@/lib/interviews";
import { plainText } from "@/lib/notes";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { InterviewWhen } from "./InterviewWhen";
import { NotesBadge } from "./NotesBadge";

/** A talk with a recruiter or agency: no application, so its notes live on the interview. */
export function GeneralTalkRow({ iv }: { iv: Interview }) {
  const openEditor = useOpenEditor();
  const upcoming = new Date(iv.starts_at) > new Date();
  const preview = plainText(iv.notes);
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
      <button type="button" onClick={() => openEditor("interview", iv.id)} className="group flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:underline">
        <InterviewWhen iv={iv} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium group-hover:underline">
            <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">General talk{talkWith(iv) ? ` · ${talkWith(iv)}` : ""}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{preview || `${interviewName(iv)} · not tied to an application`}</div>
        </div>
      </button>
      {upcoming && iv.meeting_url && (
        <Button asChild variant="ghost" size="icon-xs" aria-label="Join the call"><a href={iv.meeting_url} target="_blank" rel="noreferrer"><Video /></a></Button>
      )}
      <NotesBadge iv={iv} />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
