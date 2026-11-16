import type { ActivityItem } from "@/api/dashboard";
import { WEEKDAYS } from "@/lib/days";
import { DayCell } from "./DayCell";

export function MonthGrid({ days, byDay, ym, today, selected, onPick }: {
  days: string[];
  byDay: Map<string, ActivityItem[]>;
  ym: string;
  today: string;
  selected: string | null;
  onPick: (day: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((w) => <div key={w} className="py-1.5">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => (
          <DayCell
            key={d}
            day={d}
            items={byDay.get(d) ?? []}
            outside={!d.startsWith(ym)}
            isToday={d === today}
            isSelected={d === selected}
            onClick={() => onPick(d)}
          />
        ))}
      </div>
    </div>
  );
}
