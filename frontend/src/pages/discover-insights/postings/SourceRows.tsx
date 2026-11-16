import type { SourceDays } from "@/api/discoveryInsights";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SOURCE_LABEL } from "@/pages/discover-insights/constants";
import { pct } from "@/pages/discover-insights/format";
import { MiniColumns } from "./MiniColumns";

/** Each source with its days side by side (one scale for all, so the strips compare). */
export function SourceRows({ sources }: { sources: SourceDays[] }) {
  const max = Math.max(1, ...sources.flatMap((s) => s.days.map((d) => d.queue + d.hidden)));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead className="hidden w-[40%] sm:table-cell">Each day</TableHead>
          <TableHead className="text-right">New</TableHead>
          <TableHead className="text-right">Reached the queue</TableHead>
          <TableHead className="text-right">Hidden</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sources.map((s) => {
          const total = s.queue + s.hidden;
          return (
            <TableRow key={s.source}>
              <TableCell className="font-medium">{SOURCE_LABEL[s.source] ?? s.source}</TableCell>
              <TableCell className="hidden sm:table-cell"><MiniColumns days={s.days} max={max} /></TableCell>
              <TableCell className="text-right tabular-nums">{total.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{s.queue.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">
                {s.hidden.toLocaleString()} <span className="text-muted-foreground">· {pct(s.hidden, total)}</span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
