import { Briefcase, CalendarClock, Link2, Maximize2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { type ApplicationDetail, type Stage } from "@/api/applications";
import { NeedsReviewBanner } from "./NeedsReviewBanner";
import type { Patch } from "./patch";
import { ProcessTimeline } from "./process-timeline/ProcessTimeline";
import { EditableText } from "./properties/EditableText";
import { StagePicker } from "./StagePicker";

export function ApplicationHeader({ app, inSheet, save, setStage, onReviewed }: {
  app: ApplicationDetail;
  inSheet: boolean;
  save: (p: Patch) => Promise<void>;
  setStage: (s: Stage, round?: number | null) => Promise<void>;
  onReviewed: () => void;
}) {
  return (
    <header className={cn("space-y-3 border-b pb-5", inSheet ? "px-6 pt-6" : "")}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Briefcase className="size-4" />
        <span>Application</span>
        {inSheet && (
          <Button asChild variant="ghost" size="xs" className="ml-auto mr-8">
            <Link to={`/applications/${app.id}`}><Maximize2 /> Open page</Link>
          </Button>
        )}
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{app.company}</h2>
        <EditableText
          value={app.role_title}
          required
          className="-ml-2 text-base text-muted-foreground"
          onSave={(v) => save({ role_title: v ?? undefined })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StagePicker app={app} onPick={(s) => setStage(s)} />
        {app.next_interview_at && (
          <span className="inline-flex items-center gap-1 text-sm">
            <CalendarClock className="size-4 text-violet-500" /> {fmtDate(app.next_interview_at, true)}
          </span>
        )}
        {app.job_url && (
          <Button asChild variant="outline" size="xs">
            <a href={app.job_url} target="_blank" rel="noreferrer"><Link2 /> Posting</a>
          </Button>
        )}
      </div>
      <ProcessTimeline app={app} />
      {app.needs_review && <NeedsReviewBanner app={app} onReviewed={onReviewed} />}
    </header>
  );
}
