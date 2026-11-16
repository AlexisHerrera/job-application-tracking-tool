import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { utc } from "@/lib/days";

/** The month's title with previous / Today / next. */
export function MonthNav({ ym, onShift, onToday }: { ym: string; onShift: (n: number) => void; onToday: () => void }) {
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(utc(`${ym}-01`)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="mr-auto text-lg font-semibold">{title}</h2>
      <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => onShift(-1)}><ChevronLeft /></Button>
      <Button variant="outline" size="sm" onClick={onToday}>Today</Button>
      <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => onShift(1)}><ChevronRight /></Button>
    </div>
  );
}
