import type { Posting } from "@/api/discovery";
import { cn } from "@/lib/utils";

export function VerdictBadge({ p }: { p: Posting }) {
  if (!p.verdict) return <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-xs text-muted-foreground">not scored</span>;
  // A neutral pill; only the dot carries the verdict's colour.
  const dot = { match: "bg-good", maybe: "bg-warn", no: "bg-bad" }[p.verdict];
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 text-xs font-medium tabular-nums">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {p.verdict} · {p.score}
    </span>
  );
}
