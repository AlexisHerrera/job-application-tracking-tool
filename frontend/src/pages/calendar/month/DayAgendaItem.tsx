import { Link } from "react-router-dom";
import { fmtTime } from "@/lib/format";
import { type ActivityItem } from "@/api/dashboard";
import { interviewName } from "@/lib/interviews";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { cn } from "@/lib/utils";
import { isMeeting, KIND, meetingChip, who } from "@/pages/calendar/calendar";
import { Dot } from "@/pages/calendar/Dot";

/** A meeting opens its notes; a milestone links to its application. */
export function DayAgendaItem({ item: i }: { item: ActivityItem }) {
  const openEditor = useOpenEditor();
  return isMeeting(i) ? (
    <li>
      <button type="button" onClick={() => openEditor("interview", i.interview_id)} className="group flex w-full items-start gap-2 text-left text-sm">
        <span className={cn(meetingChip(i.upcoming, i.kind === "talk"), "shrink-0 tabular-nums")}>{fmtTime(i.at)}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium group-hover:underline">{who(i)}</span>
          <span className="block truncate text-xs text-muted-foreground">{interviewName(i)}{i.kind === "interview" ? ` · ${i.role}` : ""}</span>
        </span>
      </button>
    </li>
  ) : (
    <li>
      <Link to={`/applications/${i.application_id}`} className="group flex items-start gap-2 text-sm">
        <Dot className={cn(KIND[i.kind].dot, "mt-1.5")} />
        <span className="min-w-0">
          <span className="block truncate group-hover:underline"><span className="font-medium">{i.company}</span> · {KIND[i.kind].label}</span>
          <span className="block truncate text-xs text-muted-foreground">{i.role}</span>
        </span>
      </Link>
    </li>
  );
}
