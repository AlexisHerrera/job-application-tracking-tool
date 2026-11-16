import { fmtDate } from "@/lib/format";
import type { TimelineScale } from "./timelineScale";

/** The week labels row above the bars. */
export function TimelineAxis({ scale: { mondays, x } }: { scale: TimelineScale }) {
  return (
    <div className="grid grid-cols-[minmax(8rem,13rem)_1fr_5rem] gap-3 pb-1 text-xs text-muted-foreground">
      <span />
      <div className="relative h-4">
        {mondays.map((m) => <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(m) }}>{fmtDate(m).slice(0, 6)}</span>)}
      </div>
      <span className="text-right">Days</span>
    </div>
  );
}
