import { useState } from "react";
import { ExternalLink, MoreHorizontal, NotebookPen, Pencil, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { fmtDate, label, relativeDay } from "@/lib/format";
import { type Interview } from "@/api/interviews";
import { SOURCE_ICON, SOURCE_LABEL, interviewName } from "@/lib/interviews";
import { InterviewForm } from "./InterviewForm";

export function InterviewRow({ iv, preview, onOpen, onDone }: { iv: Interview; preview: string; onOpen: () => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const Icon = SOURCE_ICON[iv.source];
  const upcoming = new Date(iv.starts_at) > new Date();
  const cancelled = iv.status === "cancelled";
  if (editing) return <li><InterviewForm initial={iv} onDone={() => { setEditing(false); onDone(); }} onCancel={() => setEditing(false)} /></li>;

  async function remove() {
    try {
      await api.removeInterview(iv.id);
      toast.success(iv.source === "manual" ? "Interview deleted" : "Hidden. It won't come back on the next sync.");
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-lg border p-1 pr-1.5 transition-colors">
      <button type="button" onClick={onOpen} aria-label={`Notes for ${interviewName(iv)}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
        <div className={cn("w-16 shrink-0 text-center", cancelled && "opacity-50")}>
          <div className="text-xs text-muted-foreground">{fmtDate(iv.starts_at).slice(0, 6)}</div>
          <div className="text-sm font-medium tabular-nums">{fmtDate(iv.starts_at, true).slice(-5)}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-medium", cancelled && "text-muted-foreground line-through")}>{interviewName(iv)}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5 shrink-0" aria-label={SOURCE_LABEL[iv.source]} />
            <span>{cancelled ? "cancelled" : relativeDay(iv.starts_at)}</span>
            {iv.interview_type && <span>· {label(iv.interview_type)}</span>}
          </div>
          {preview && <div className="truncate pt-0.5 text-xs text-muted-foreground/80">{preview}</div>}
        </div>
        {upcoming && !cancelled && <span className="rounded-full bg-violet-500/10 px-2 text-xs leading-5 text-violet-700 dark:text-violet-300">upcoming</span>}
        {iv.notes_count > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label={`${iv.notes_count} notes`}><NotebookPen className="size-3.5" />{iv.notes_count}</span>
        ) : !upcoming && !cancelled ? (
          <span className="rounded-full bg-amber-500/10 px-2 text-xs leading-5 text-amber-800 dark:text-amber-300">no notes</span>
        ) : null}
      </button>
      {upcoming && iv.meeting_url && !cancelled && (
        <Button asChild variant="ghost" size="icon-xs" aria-label="Join the call"><a href={iv.meeting_url} target="_blank" rel="noreferrer"><Video /></a></Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="Interview actions"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> Edit round, type, title</DropdownMenuItem>
          {iv.html_link && (
            <DropdownMenuItem asChild><a href={iv.html_link} target="_blank" rel="noreferrer"><ExternalLink /> Open in Google Calendar</a></DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={remove}>
            <Trash2 /> {iv.source === "manual" ? "Delete" : "Not an interview: hide"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
