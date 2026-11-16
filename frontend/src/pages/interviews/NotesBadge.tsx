import { NotebookPen } from "lucide-react";
import type { Interview } from "@/api/interviews";

export function NotesBadge({ iv }: { iv: Interview }) {
  const past = new Date(iv.starts_at) < new Date();
  if (iv.notes_count > 0) {
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label={`${iv.notes_count} notes`}><NotebookPen className="size-3.5" />{iv.notes_count}</span>;
  }
  return past ? <span className="rounded-full bg-amber-500/10 px-2 text-xs leading-5 text-amber-800 dark:text-amber-300">no notes</span> : null;
}
