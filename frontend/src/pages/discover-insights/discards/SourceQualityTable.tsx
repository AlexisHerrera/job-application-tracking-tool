import type { SourceQuality } from "@/api/discoveryInsights";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SOURCE_LABEL } from "@/pages/discover-insights/constants";
import { pct } from "@/pages/discover-insights/format";

const BAD: { key: "closed" | "fake" | "no_apply" | "duplicate"; label: string }[] = [
  { key: "closed", label: "Closed" },
  { key: "fake", label: "Fake" },
  { key: "no_apply", label: "No way to apply" },
  { key: "duplicate", label: "Duplicate" },
];

/** Per source: what was reviewed from it, how much was worth keeping, and how much was a bad
 * posting (closed, fake, no way in, a repost). */
export function SourceQualityTable({ rows }: { rows: SourceQuality[] }) {
  return (
    <section>
      <h3 className="text-sm font-medium">Source quality</h3>
      <p className="mt-0.5 mb-2 text-xs text-muted-foreground">What each source brought to review in this window, and how much of it was a bad posting.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Reviewed</TableHead>
            <TableHead className="text-right">Kept</TableHead>
            {BAD.map((b) => <TableHead key={b.key} className="text-right">{b.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.source}>
              <TableCell className="font-medium">{SOURCE_LABEL[r.source] ?? r.source}</TableCell>
              <TableCell className="text-right tabular-nums">{r.reviewed}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.kept} <span className="text-muted-foreground">· {pct(r.kept, r.reviewed)}</span>
              </TableCell>
              {BAD.map((b) => (
                <TableCell key={b.key} className="text-right tabular-nums">
                  {r[b.key] ? r[b.key] : <span className="text-muted-foreground">—</span>}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
