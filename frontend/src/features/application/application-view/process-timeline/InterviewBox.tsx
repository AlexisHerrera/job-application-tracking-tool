import { NotebookPen, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDate, relativeDay } from "@/lib/format";
import { type Interview } from "@/api/interviews";
import { interviewName } from "@/lib/interviews";

export function InterviewBox({ iv, label, onOpen }: { iv: Interview; label: string; onOpen: () => void }) {
  const upcoming = new Date(iv.starts_at) > new Date();
  const name = interviewName(iv);
  return (
    <div className="space-y-2 rounded-lg border p-2.5">
      <div className="text-xs">
        {name !== label && <div className="truncate font-medium">{name}</div>}
        <div className="text-muted-foreground tabular-nums">{fmtDate(iv.starts_at, true)} · {relativeDay(iv.starts_at)}</div>
      </div>
      <div className="flex gap-1.5">
        <Button size="xs" variant="outline" onClick={onOpen}><NotebookPen /> {iv.notes_count ? `Notes · ${iv.notes_count}` : upcoming ? "Prep notes" : "Write notes"}</Button>
        {upcoming && iv.meeting_url && (
          <Button asChild size="xs" variant="ghost"><a href={iv.meeting_url} target="_blank" rel="noreferrer"><Video /> Join</a></Button>
        )}
      </div>
    </div>
  );
}
