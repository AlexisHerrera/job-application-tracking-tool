import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api, fmtDate, fmtTime, localDay } from "@/api";
import { talkWith } from "@/lib/interviews";
import { calendarDayLink, monthDays, shiftMonth, utc, WEEKDAYS } from "@/lib/days";
import { useAsync } from "@/useAsync";

/** A month of interviews beside the dashboard's upcoming list. Days open the calendar page on that day. */
export function MiniCalendar({ className }: { className?: string }) {
  const { data } = useAsync(api.interviews);
  const today = localDay(new Date());
  const [ym, setYm] = useState(today.slice(0, 7));
  const byDay = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>>();
    for (const iv of data ?? []) {
      const d = localDay(iv.starts_at);
      m.set(d, [...(m.get(d) ?? []), iv]);
    }
    return m;
  }, [data]);

  const days = monthDays(ym);
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(utc(`${ym}-01`)));
  const now = new Date().toISOString();
  const current = ym === today.slice(0, 7);

  return (
    <Card className={cn("gap-0 py-3", className)}>
      <CardContent className="flex h-full flex-col gap-2 px-3">
        <div className="flex items-center gap-1">
          <Link to={current ? "/calendar" : `/calendar?month=${ym}`} className="mr-auto pl-1 text-sm font-medium hover:underline">{title}</Link>
          {!current && <Button variant="ghost" size="xs" onClick={() => setYm(today.slice(0, 7))}>Today</Button>}
          <Button variant="ghost" size="icon-xs" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}><ChevronLeft /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="Next month" onClick={() => setYm(shiftMonth(ym, 1))}><ChevronRight /></Button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAYS.map((w) => <div key={w} className="pb-0.5 text-[0.7rem] text-muted-foreground">{w.slice(0, 2)}</div>)}
          {days.map((d) => {
            const ivs = byDay.get(d) ?? [];
            const scheduled = ivs.some((iv) => iv.starts_at >= now);
            const names = ivs.map((iv) => `${fmtTime(iv.starts_at)} ${iv.general ? `talk · ${talkWith(iv) ?? ""}` : iv.company ?? "?"}`);
            return (
              <Link
                key={d}
                to={calendarDayLink(d, today)}
                title={[fmtDate(d), ...names].join("\n")}
                aria-label={`${fmtDate(d)}${names.length ? `: ${names.join(", ")}` : ""}`}
                className={cn(
                  "grid h-7 place-items-center rounded-md text-xs tabular-nums transition-colors hover:bg-muted",
                  !d.startsWith(ym) && !ivs.length && "text-muted-foreground/50",
                  d.startsWith(ym) && d < today && !ivs.length && "text-muted-foreground",
                  ivs.length > 0 && !scheduled && "bg-violet-500/15 font-medium text-violet-800 hover:bg-violet-500/25 dark:text-violet-200",
                  scheduled && "font-medium text-violet-700 ring-1 ring-violet-500/70 ring-inset dark:text-violet-300",
                )}
              >
                <span className={cn("grid size-6 place-items-center rounded-full", d === today && "bg-primary font-semibold text-primary-foreground")}>{+d.slice(8)}</span>
              </Link>
            );
          })}
        </div>
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pl-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-violet-500/30" /> interview</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] ring-1 ring-violet-500/70 ring-inset" /> scheduled</span>
        </div>
      </CardContent>
    </Card>
  );
}
