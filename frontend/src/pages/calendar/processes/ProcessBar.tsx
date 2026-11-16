import { fmtDate, localDay, type Process } from "@/api";
import { addDays } from "@/lib/days";
import { interviewName } from "@/lib/interviews";
import { STATUS_META } from "@/lib/status";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { cn } from "@/lib/utils";
import { END_CAP, isOpen as open, OUTCOME_TEXT } from "@/pages/calendar/calendar";
import type { TimelineScale } from "./timelineScale";

/** The Monday lines and today's line behind each bar. */
function Ticks({ scale: { mondays, x }, today }: { scale: TimelineScale; today: string }) {
  return (
    <>
      {mondays.map((m) => <div key={m} className="absolute inset-y-0 w-px bg-border/70" style={{ left: x(m) }} />)}
      <div className="absolute inset-y-0 w-0.5 bg-primary/50" style={{ left: x(today, true) }} />
    </>
  );
}

/** The bar (moving, quiet or closed), its end cap, the first reply mark and the interview dots. */
export function ProcessBar({ process: p, scale, today }: { process: Process; scale: TimelineScale; today: string }) {
  const openEditor = useOpenEditor();
  const { x, width } = scale;
  const applied = p.applied_at ? localDay(p.applied_at) : null;
  // A ghosted process stopped at its last news; an open one runs to today.
  const endDay = p.ended_at ? localDay(p.ended_at) : p.status === "ghosted" && p.last_event_at ? localDay(p.last_event_at) : today;
  const lastNews = p.last_event_at && open(p) ? localDay(p.last_event_at) : endDay;
  return (
    <div className="relative h-8">
      <Ticks scale={scale} today={today} />
      {applied && (
        <>
          {open(p) ? (
            <>
              <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-(--flow-screening)" style={{ left: x(applied), width: width(applied, lastNews) }} />
              {lastNews < today && (
                <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-r-full bg-(--flow-screening) opacity-30" style={{ left: x(addDays(lastNews, 1)), width: width(addDays(lastNews, 1), today) }} />
              )}
            </>
          ) : (
            <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted-foreground/30" style={{ left: x(applied), width: width(applied, endDay) }} />
          )}
          {END_CAP[p.status] && (
            <span
              className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm ring-2 ring-card", END_CAP[p.status])}
              style={{ left: x(endDay, true) }}
              title={`${STATUS_META[p.status].label} · ${fmtDate(p.ended_at ?? p.last_event_at)}`}
            />
          )}
        </>
      )}
      {p.reply_at && (
        <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-amber-500" style={{ left: x(localDay(p.reply_at), true) }} title={`First reply · ${fmtDate(p.reply_at)}`} />
      )}
      {p.interviews.map((iv) => (
        <button
          key={iv.id}
          type="button"
          onClick={() => openEditor("interview", iv.id)}
          aria-label={`${interviewName(iv)} · ${fmtDate(iv.at, true)}${iv.outcome ? ` · ${OUTCOME_TEXT[iv.outcome]}` : ""}`}
          title={`${interviewName(iv)} · ${fmtDate(iv.at, true)}${iv.outcome ? ` · ${OUTCOME_TEXT[iv.outcome]}` : ""}`}
          className="absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: x(localDay(iv.at), true) }}
        >
          <span className={cn("size-3 rounded-full ring-2", iv.upcoming ? "bg-card ring-violet-500" : "bg-violet-500 ring-card")} />
        </button>
      ))}
    </div>
  );
}
