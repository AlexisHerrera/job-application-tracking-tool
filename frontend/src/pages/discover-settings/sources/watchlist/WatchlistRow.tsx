import { ExternalLink } from "lucide-react";
import type { WatchedCompany } from "@/api/discoverySettings";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { safeUrl } from "@/lib/links";
import { ATS_LABELS } from "./constants";

function StatusText({ c }: { c: WatchedCompany }) {
  if (!c.last_checked_at) return <span className="text-muted-foreground">not read yet</span>;
  const when = timeAgo(c.last_checked_at);
  if (c.last_status === "gone") return <span className="text-destructive">board gone · {when}</span>;
  if (c.last_status && c.last_status !== "ok") return <span className="text-destructive" title={c.last_status}>failed · {when}</span>;
  return <span className="text-muted-foreground">{when}</span>;
}

/** One watched company: on/off, its board, what the last read kept. */
export function WatchlistRow({ c, onToggle, busy }: { c: WatchedCompany; onToggle: (on: boolean) => void; busy: boolean }) {
  const url = c.board_url ? safeUrl(c.board_url) : null;
  return (
    <TableRow className={cn(!c.enabled && "text-muted-foreground")}>
      <TableCell className="w-8">
        <Checkbox checked={c.enabled} disabled={busy} onCheckedChange={(v) => onToggle(v === true)} aria-label={`Watch ${c.name}`} />
      </TableCell>
      <TableCell className="max-w-56">
        <div className="truncate font-medium">{c.name}</div>
        {c.note && <div className="truncate text-xs text-muted-foreground" title={c.note}>{c.note}</div>}
      </TableCell>
      <TableCell className="text-xs">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
            {ATS_LABELS[c.ats]} · {c.slug} <ExternalLink className="size-3" />
          </a>
        ) : (
          `${ATS_LABELS[c.ats]} · ${c.slug}`
        )}
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums" title="Engineering roles in your locations / every job on the board, at the last read">
        {c.jobs_total === null ? "–" : <><span className={cn(c.jobs_kept ? "font-medium text-foreground" : "")}>{c.jobs_kept ?? 0}</span> / {c.jobs_total}</>}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap"><StatusText c={c} /></TableCell>
    </TableRow>
  );
}
