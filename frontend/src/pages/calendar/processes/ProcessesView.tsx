import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { localDay } from "@/lib/format";
import { type Process } from "@/api/dashboard";
import { isOpen as open, type SetParams } from "@/pages/calendar/calendar";
import { ProcessesLegend } from "./ProcessesLegend";
import { ProcessRow } from "./ProcessRow";
import { TimelineAxis } from "./TimelineAxis";
import { timelineScale } from "./timelineScale";

/** Each application as a bar from applied to its final answer (or today), with its interviews on it. */
export function ProcessesView({ processes, hideClosed, set }: { processes: Process[]; hideClosed: boolean; set: SetParams }) {
  const today = localDay(new Date());
  const rows = [...processes.filter(open), ...(hideClosed ? [] : processes.filter((p) => !open(p)))];
  const dated = processes.filter((p) => p.applied_at);
  if (!dated.length) return <p className="text-sm text-muted-foreground">No applications in this campaign yet.</p>;

  const scale = timelineScale(processes, today);
  const closedCount = processes.length - processes.filter(open).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ProcessesLegend />
        {closedCount > 0 && (
          <Button variant={hideClosed ? "secondary" : "ghost"} size="sm" className="ml-auto" aria-pressed={hideClosed} onClick={() => set({ closed: hideClosed ? null : "hide" })}>
            Hide closed ({closedCount})
          </Button>
        )}
      </div>
      <Card className="py-3">
        <CardContent className="overflow-x-auto px-3">
          <div className="min-w-2xl">
            <TimelineAxis scale={scale} />
            <div className="divide-y">
              {rows.map((p) => <ProcessRow key={p.application_id} process={p} scale={scale} today={today} />)}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
