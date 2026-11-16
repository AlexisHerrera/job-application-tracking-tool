import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { ReviewQueue } from "./useReviewQueue";

/** How far through the queue, with Back and Skip. */
export function ReviewProgress({ q, atEnd }: { q: ReviewQueue; atEnd: boolean }) {
  const pct = q.total ? (100 * q.decided) / q.total : 0;
  return (
    <div className="mb-3 flex items-center gap-3">
      <Button variant="ghost" size="sm" disabled={q.index === 0} onClick={q.back} title="Previous posting"><ArrowLeft /> Back <Kbd>←</Kbd></Button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground tabular-nums">
          <span><span className="font-medium text-foreground">{q.left}</span> left to sort</span>
          <span>{q.decided} sorted{q.skipped > 0 && ` · ${q.skipped} skipped`}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <Button variant="ghost" size="sm" disabled={atEnd} onClick={q.next} title="Decide later: it stays in the queue">Skip <Kbd>→</Kbd> <ArrowRight /></Button>
    </div>
  );
}
