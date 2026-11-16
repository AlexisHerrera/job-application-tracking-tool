import type { DiscoveryProgress } from "@/api";
import { duration, eta } from "@/pages/discover/format";
import { ProgressStep, type StepState } from "./ProgressStep";

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Progress of a run or a re-score. */
export function RunProgressPanel({ p, kind, collectOnly = false }: { p: DiscoveryProgress | null; kind: "run" | "score" | "rescore"; collectOnly?: boolean }) {
  const live = p?.kind ? p : null; // {running: false} alone: nothing reported yet
  const phase = live?.phase;
  const total = live?.searches_total ?? 0;
  const done = live?.searches_done ?? 0;
  const toScore = live?.to_score ?? 0;
  const scored = live?.scored ?? 0;
  const collectState: StepState = !live ? "pending" : phase === "collecting" ? "active" : "done";
  const scoreState: StepState = phase === "scoring" ? "active" : phase === "done" ? "done" : "pending";
  const errors = live?.errors ?? 0;

  return (
    <div className="mb-4 rounded-lg border bg-card p-3" aria-live="polite">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{kind === "run" ? "Finding new openings" : kind === "score" ? "Scoring postings" : "Re-scoring postings"}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {live?.elapsed_s != null ? duration(live.elapsed_s) : "starting…"}
        </span>
      </div>
      <ol className="space-y-2.5">
        {kind === "run" && (
          <ProgressStep state={collectState} title={total ? `Collect from your searches and company boards (${Math.min(done, total)} of ${total})` : "Collect from your searches and company boards"}>
            {collectState === "active" && live?.current && (
              <>
                Reading “{live.current}”{eta(live.phase_elapsed_s, done, total) && ` · ${eta(live.phase_elapsed_s, done, total)}`}
                <Bar done={done} total={total} />
              </>
            )}
            {live && (live.fetched ?? 0) > 0 && (
              <div className="mt-1">
                {live.fetched} found · {live.new} new · {live.hidden} hidden by the rules
              </div>
            )}
          </ProgressStep>
        )}
        {!collectOnly && <ProgressStep state={scoreState} title={scoreState === "pending" || !toScore ? "Score with AI" : `Score with AI (${scored} of ${toScore})`}>
          {scoreState === "active" && (
            toScore === 0 ? (
              "Nothing to score"
            ) : (
              <>
                6 at a time{eta(live?.phase_elapsed_s, scored, toScore) ? ` · ${eta(live?.phase_elapsed_s, scored, toScore)}` : scored === 0 ? " · waiting for the first answers" : ""}
                <Bar done={scored} total={toScore} />
              </>
            )
          )}
        </ProgressStep>}
      </ol>
      {errors > 0 && <p className="mt-2 text-xs text-destructive">{errors} error{errors === 1 ? "" : "s"} so far; the rest keeps going.</p>}
      <p className="mt-2.5 text-xs text-muted-foreground">You can leave this page: the run keeps going, and the list refreshes when it ends.</p>
    </div>
  );
}
