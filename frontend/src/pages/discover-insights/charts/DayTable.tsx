import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { longDay } from "@/pages/discover-insights/format";
import type { Series } from "@/pages/discover-insights/constants";

/** The chart as a table: the days with anything, newest first. */
export function DayTable<K extends string>({ days, rows, series }: { days: string[]; rows: Record<K, number>[]; series: Series<K>[] }) {
  const lines = days
    .map((day, i) => ({ day, row: rows[i], total: series.reduce((n, s) => n + rows[i][s.key], 0) }))
    .filter((l) => l.total > 0)
    .reverse();
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            {series.map((s) => <TableHead key={s.key} className="text-right">{s.label}</TableHead>)}
            {series.length > 1 && <TableHead className="text-right">In all</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.day}>
              <TableCell>{longDay(l.day)}</TableCell>
              {series.map((s) => <TableCell key={s.key} className="text-right tabular-nums">{l.row[s.key].toLocaleString()}</TableCell>)}
              {series.length > 1 && <TableCell className="text-right font-medium tabular-nums">{l.total.toLocaleString()}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {lines.length < days.length && <p className="mt-2 text-xs text-muted-foreground">Days with nothing are left out.</p>}
    </>
  );
}
