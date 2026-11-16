import { Card, CardContent } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import { type ActivityItem } from "@/api/dashboard";
import { DayAgendaItem } from "./DayAgendaItem";

/** The side card for the picked day. */
export function DayAgenda({ day: selected, items: dayItems }: { day: string | null; items: ActivityItem[] }) {
  return (
    <Card className="h-fit lg:sticky lg:top-6">
      <CardContent className="space-y-3">
        <h3 className="font-medium">{selected ? fmtDate(selected) : "Pick a day"}</h3>
        {selected && dayItems.length === 0 && <p className="text-sm text-muted-foreground">Nothing that day.</p>}
        <ul className="space-y-2">
          {dayItems.map((i, n) => <DayAgendaItem key={n} item={i} />)}
        </ul>
      </CardContent>
    </Card>
  );
}
