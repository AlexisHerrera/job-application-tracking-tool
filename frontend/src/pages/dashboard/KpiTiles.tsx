import { StatTile } from "@/components/StatTile";
import { cn } from "@/lib/utils";
import type { CampaignSummary } from "@/api/campaigns";
import type { Stats } from "@/api/dashboard";
import type { Status } from "@/api/applications";
import { ACTIVE_STATUSES } from "@/lib/status";

/** Applications, active, interviews done, days to the first interview. */
export function KpiTiles({ stats, campaign: c, besideCalendar }: { stats: Stats | null; campaign: CampaignSummary | null; besideCalendar: boolean }) {
  const active = stats ? Object.entries(stats.by_status).reduce((n, [s, k]) => n + (ACTIVE_STATUSES.has(s as Status) ? k : 0), 0) : null;
  const interviews = stats?.funnel.find((f) => f.stage === "interviewing");

  // Beside the calendar the column is narrower, so four across waits for xl.
  return (
    <div className={cn("grid grid-cols-2 gap-3", besideCalendar ? "xl:grid-cols-4" : "lg:grid-cols-4")}>
      <StatTile label="Applications" value={stats?.total ?? c?.applications ?? "—"} sub={c ? `day ${c.day} · ${c.per_week} per week` : undefined} />
      <StatTile label="Active" value={active ?? "—"} sub="applied, screening, interviewing, on hold" />
      <StatTile
        label="Interviews done"
        value={stats?.interviews.done ?? "—"}
        sub={stats ? `${stats.interviews.upcoming} upcoming${interviews ? ` · ${interviews.pct}% of applications got one` : ""}` : undefined}
      />
      <StatTile
        label="Days to 1st interview"
        value={c?.days_to_first_interview ?? "—"}
        sub={stats?.time_to_first_response.median_days != null ? `first reply in ${stats.time_to_first_response.median_days} days (median)` : undefined}
      />
    </div>
  );
}
