import { useState } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Series } from "@/pages/discover-insights/constants";
import { DayColumns } from "./DayColumns";
import { DayTable } from "./DayTable";

/** A day chart with its legend (each series' total for the window) and a table view. */
export function DayChart<K extends string>({ days, rows, series, noun }: { days: string[]; rows: Record<K, number>[]; series: Series<K>[]; noun: string }) {
  const [asTable, setAsTable] = useState(false);
  const total = (k: K) => rows.reduce((n, r) => n + r[k], 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {[...series].reverse().map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label} <span className="font-medium text-foreground tabular-nums">{total(s.key).toLocaleString()}</span>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="xs" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
          {asTable ? <><ChartColumn /> Chart</> : <><Table2 /> Table</>}
        </Button>
      </div>
      {asTable ? <DayTable days={days} rows={rows} series={series} /> : <DayColumns days={days} rows={rows} series={series} noun={noun} />}
    </div>
  );
}
