import { Trash2 } from "lucide-react";
import type { DiscoverySearch } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { FetchStatus } from "./FetchStatus";
import { LastFound } from "./LastFound";
import { paramsSummary } from "./paramsSummary";

/** A search that has brought nothing for this long is marked: it may be broken. */
const STALE_DAYS = 7;

/** One saved search: on/off, what it asks, how its last fetch went, delete. */
export function SearchRow({ x, onToggle, onDelete }: { x: DiscoverySearch; onToggle: (on: boolean) => void; onDelete: () => void }) {
  const failed = x.last_status !== null && x.last_status !== "ok";
  return (
    <TableRow className={cn(!x.enabled && "text-muted-foreground")}>
      <TableCell className="w-8">
        <Checkbox checked={x.enabled} onCheckedChange={(c) => onToggle(c === true)} aria-label={`Enable ${x.label}`} />
      </TableCell>
      <TableCell className="max-w-72">
        <div className="truncate">{x.label}</div>
        <div className="truncate text-xs text-muted-foreground">{x.source} · {paramsSummary(x)}</div>
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums" title="Postings the last fetch that worked brought">
        {x.last_count === null ? "–" : <span className={cn(failed && "text-muted-foreground")}>{x.last_count}</span>}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        <LastFound at={x.last_found_at} readAt={x.last_fetched_at} staleDays={x.enabled ? STALE_DAYS : undefined} />
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap">
        <FetchStatus at={x.last_fetched_at} status={x.last_status} failStreak={x.fail_streak} />
      </TableCell>
      <TableCell className="w-8">
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${x.label}`} onClick={onDelete}><Trash2 /></Button>
      </TableCell>
    </TableRow>
  );
}
