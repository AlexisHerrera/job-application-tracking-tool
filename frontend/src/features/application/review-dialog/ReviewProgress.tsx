/** "3 of 8 left · 2 of 10 done" and the bar under it. */
export function ReviewProgress({ index, left, reviewed, total }: { index: number; left: number; reviewed: number; total: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{index + 1} of {left} left</span>
        <span>{reviewed} of {total} done</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${total ? (100 * reviewed) / total : 0}%` }} />
      </div>
    </div>
  );
}
