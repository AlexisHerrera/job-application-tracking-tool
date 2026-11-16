import { timeAgo } from "@/lib/format";
import { type DiscoveryRun } from "@/api/discovery";

export function LastRunSummary({ run, used, cap, jsearchOn }: { run: DiscoveryRun | null; used: number; cap: number; jsearchOn: boolean }) {
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
      {jsearchOn && <>{" · "}JSearch this month: {used} / {cap}</>}
    </p>
  );
}
