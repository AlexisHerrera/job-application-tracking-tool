import type { DiscoveryRun } from "@/api/discovery";
import { duration } from "@/features/discovery/progress/timeLeft";
import { fmtDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

function Count({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <span className="font-medium text-foreground tabular-nums">{n.toLocaleString()}</span> {label}
    </span>
  );
}

/** One collection, scoring or re-score: when, what it found, its notes and errors. */
export function RunRow({ run }: { run: DiscoveryRun }) {
  const took = run.finished_at ? (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000 : null;
  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{fmtDate(run.started_at, true)}</span>
          <span className="text-xs text-muted-foreground"> · {timeAgo(run.started_at)} · {run.trigger}{took !== null ? ` · took ${duration(took)}` : " · didn't finish"}</span>
        </div>
        {run.errors > 0 && <span className="rounded-full bg-destructive/10 px-2 text-xs font-medium text-destructive">{run.errors} error{run.errors === 1 ? "" : "s"}</span>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Count n={run.fetched} label="read" />
        <Count n={run.new} label="new" />
        <Count n={run.dropped} label="hidden" />
        <Count n={run.llm_calls} label="scored" />
        {run.jsearch_requests > 0 && <Count n={run.jsearch_requests} label="JSearch requests" />}
      </div>
      {run.notes.length > 0 && (
        <ul className={cn("space-y-0.5 rounded-md px-2.5 py-1.5 text-xs", run.errors > 0 ? "bg-destructive/5 text-destructive" : "bg-muted/50 text-muted-foreground")}>
          {run.notes.map((n, i) => <li key={i} className="break-words">{n}</li>)}
        </ul>
      )}
    </li>
  );
}
