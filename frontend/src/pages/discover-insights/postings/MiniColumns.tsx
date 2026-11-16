import type { PostingsDay } from "@/api/discoveryInsights";
import { cn } from "@/lib/utils";

const HEIGHT = 28;

/** A source's days as a strip of tiny columns: reached the queue below, hidden above. The
 * numbers are in the row and in the chart's table view; the strip shows the shape. */
export function MiniColumns({ days, max }: { days: PostingsDay[]; max: number }) {
  return (
    <div aria-hidden className="flex items-end gap-px" style={{ height: HEIGHT }}>
      {days.map((d, i) => {
        const queue = (d.queue / max) * HEIGHT;
        const hidden = (d.hidden / max) * HEIGHT;
        const empty = d.queue + d.hidden === 0;
        return (
          <div key={i} className="flex min-w-px flex-1 flex-col justify-end gap-px" title={empty ? undefined : `${d.queue} reached the queue · ${d.hidden} hidden`}>
            {d.hidden > 0 && <div className="rounded-t-[2px]" style={{ height: Math.max(1, hidden), background: "var(--insight-aside)" }} />}
            {d.queue > 0 && <div className={cn(d.hidden === 0 && "rounded-t-[2px]")} style={{ height: Math.max(1, queue), background: "var(--insight-queue)" }} />}
            {empty && <div className="h-px bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
