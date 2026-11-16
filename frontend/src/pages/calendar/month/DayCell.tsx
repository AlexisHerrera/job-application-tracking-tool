import { fmtDate, fmtTime, type ActivityItem } from "@/api";
import { cn } from "@/lib/utils";
import { isMeeting, KIND, meetingChip, who } from "@/pages/calendar/calendar";
import { Dot } from "@/pages/calendar/Dot";

export function DayCell({ day: d, items: its, outside: out, isToday, isSelected, onClick }: {
  day: string;
  items: ActivityItem[];
  outside: boolean;
  isToday: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const meetings = its.filter(isMeeting);
  const counts = Object.keys(KIND).map((k) => [k, its.filter((i) => i.kind === k).length] as const).filter(([, n]) => n);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`${fmtDate(d)}: ${its.length ? `${its.length} things` : "nothing"}`}
      className={cn(
        "flex min-h-24 flex-col gap-1 border-r border-b p-1.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-h-28 [&:nth-child(7n)]:border-r-0",
        out && "bg-muted/20 text-muted-foreground",
        isSelected && "bg-primary/5 ring-2 ring-primary/40 ring-inset",
      )}
    >
      <span className={cn("grid size-6 place-items-center rounded-full text-xs tabular-nums", isToday && "bg-primary font-semibold text-primary-foreground")}>
        {+d.slice(8)}
      </span>
      {meetings.slice(0, 3).map((m) => (
        <span key={m.id} className={cn(meetingChip(m.upcoming, m.kind === "talk"), "hidden truncate sm:block")}>
          <span className="tabular-nums">{fmtTime(m.at)}</span> {who(m)}
        </span>
      ))}
      {meetings.length > 3 && <span className="hidden text-xs text-muted-foreground sm:block">+{meetings.length - 3} more</span>}
      {meetings.length > 0 && <span className="flex gap-0.5 sm:hidden">{meetings.map((m) => <Dot key={m.id} className="bg-violet-500" />)}</span>}
      {counts.length > 0 && (
        <span className="mt-auto flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs">
          {counts.map(([k, n]) => <span key={k} className="inline-flex items-center gap-1 tabular-nums" title={`${n} ${KIND[k].label}`}><Dot className={KIND[k].dot} />{n}</span>)}
        </span>
      )}
    </button>
  );
}
