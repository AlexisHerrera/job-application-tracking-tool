import { CircleCheck, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewQueue } from "./useReviewQueue";

/** The end of the queue. */
export function ReviewDone({ q }: { q: ReviewQueue }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
      <CircleCheck className="size-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">{q.skipped > 0 ? "That's the end of the queue" : "All sorted"}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {q.decided > 0 ? `You sorted ${q.decided} posting${q.decided === 1 ? "" : "s"} this round. ` : ""}
        {q.skipped > 0 ? `${q.skipped} skipped ${q.skipped === 1 ? "is" : "are"} still waiting.` : "Nothing left with these filters: run the searches, or switch the view above."}
      </p>
      {q.skipped > 0 && <Button onClick={q.restart}><RotateCcw /> Go through the skipped ones</Button>}
    </div>
  );
}
