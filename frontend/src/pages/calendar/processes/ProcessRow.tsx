import { Link } from "react-router-dom";
import type { Process } from "@/api";
import { StatusDot } from "@/components/common";
import { STATUS_META } from "@/lib/status";
import { isOpen as open } from "@/pages/calendar/calendar";
import { ProcessBar } from "./ProcessBar";
import type { TimelineScale } from "./timelineScale";

/** Company and role, the bar, and the days column. */
export function ProcessRow({ process: p, scale, today }: { process: Process; scale: TimelineScale; today: string }) {
  return (
    <div className="grid grid-cols-[minmax(8rem,13rem)_1fr_5rem] items-center gap-3 py-1">
      <Link to={`/applications/${p.application_id}`} className="group min-w-0 text-sm">
        <span className="flex items-center gap-1.5"><StatusDot status={p.status} /><span className="truncate font-medium group-hover:underline">{p.company}</span></span>
        <span className="block truncate pl-3.5 text-xs text-muted-foreground">{p.role}</span>
      </Link>
      <ProcessBar process={p} scale={scale} today={today} />
      <div className="text-right text-xs">
        <div className="font-medium tabular-nums">{p.days ?? "—"} d</div>
        <div className="text-muted-foreground">
          {open(p) ? (p.quiet_days ? `quiet ${p.quiet_days} d` : "news today") : STATUS_META[p.status].label.toLowerCase()}
        </div>
      </div>
    </div>
  );
}
