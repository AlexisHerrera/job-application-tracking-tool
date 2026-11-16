import { NotebookPen } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtTime, relativeDay, type Interview } from "@/api";
import { interviewName } from "@/lib/interviews";
import { JoinCallButton } from "./JoinCallButton";
import { who } from "./who";

/** The next interview, big: when, who, and the Notes / Join call buttons. */
export function NextInterview({ next }: { next: Interview }) {
  const when = relativeDay(next.starts_at);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Link to={`?interview=${next.id}`} className="group flex min-w-0 flex-1 items-center gap-4">
        <div className="shrink-0 rounded-lg border bg-card px-3 py-1.5 text-center">
          <div className="text-xs font-medium text-violet-600 capitalize dark:text-violet-300">{when}</div>
          <div className="text-xl font-semibold tabular-nums">{fmtTime(next.starts_at)}</div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold group-hover:underline">{who(next)}</div>
          <div className="truncate text-sm text-muted-foreground">
            {next.general ? interviewName(next) : `${interviewName(next)}${next.role ? ` · ${next.role}` : ""}`}
          </div>
          <div className="text-xs text-muted-foreground">{fmtDate(next.starts_at)}</div>
        </div>
      </Link>
      <div className="flex shrink-0 gap-2">
        <Button asChild size="sm" variant="outline"><Link to={`?interview=${next.id}`}><NotebookPen /> Notes</Link></Button>
        <JoinCallButton i={next} size="sm" />
      </div>
    </div>
  );
}
