import { useMemo } from "react";
import { localDay } from "@/lib/format";
import { type ActivityItem } from "@/api/dashboard";
import { monthDays, shiftMonth } from "@/lib/days";
import type { SetParams } from "@/pages/calendar/calendar";
import { DayAgenda } from "./DayAgenda";
import { MonthGrid } from "./MonthGrid";
import { MonthLegend } from "./MonthLegend";
import { MonthNav } from "./MonthNav";

export function MonthView({ items, month, day, set }: { items: ActivityItem[]; month: string | null; day: string | null; set: SetParams }) {
  const today = localDay(new Date());
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  const selected = day ?? (today.startsWith(ym) ? today : null);
  const byDay = useMemo(() => {
    const m = new Map<string, ActivityItem[]>();
    for (const i of items) {
      const d = localDay(i.at);
      m.set(d, [...(m.get(d) ?? []), i]);
    }
    return m;
  }, [items]);

  const shift = (n: number) => {
    const d = shiftMonth(ym, n);
    set({ month: d === today.slice(0, 7) ? null : d, day: null });
  };
  const dayItems = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <MonthNav ym={ym} onShift={shift} onToday={() => set({ month: null, day: null })} />
        <MonthLegend />
        <MonthGrid
          days={monthDays(ym)}
          byDay={byDay}
          ym={ym}
          today={today}
          selected={selected}
          onPick={(d) => set({ day: d, month: ym === today.slice(0, 7) ? null : ym })}
        />
      </div>

      <DayAgenda day={selected} items={dayItems} />
    </div>
  );
}
