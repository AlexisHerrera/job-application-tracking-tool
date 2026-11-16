import { timeAgo } from "@/lib/format";
import { type DiscoveryRun } from "@/api/discovery";

export function LastRunSummary({ run }: { run: DiscoveryRun | null }) {
  return (
    <p className="mb-4 text-xs text-muted-foreground">
      {run ? (
        <>
          Last run {timeAgo(run.finished_at ?? run.started_at)}: {run.new} new, {run.dropped} hidden, {run.llm_calls} scored
          {run.errors > 0 && <span className="text-destructive"> · {run.errors} error{run.errors === 1 ? "" : "s"} ({run.notes.join(" · ")})</span>}
        </>
      ) : (
        "Never run."
      )}
    </p>
  );
}
