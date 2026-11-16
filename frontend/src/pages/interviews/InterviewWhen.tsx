import { fmtDate, relativeDay, type Interview } from "@/api";

/** The date column: day and time, and how far away it is. */
export function InterviewWhen({ iv }: { iv: Interview }) {
  return (
    <div className="w-28 shrink-0">
      <div className="text-sm font-medium tabular-nums">{fmtDate(iv.starts_at, true).replace(/ \d{4},/, ",")}</div>
      <div className="text-xs text-muted-foreground">{relativeDay(iv.starts_at)}</div>
    </div>
  );
}
