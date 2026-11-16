import type { Posting } from "@/api/discovery";
import { cn } from "@/lib/utils";

export function VerdictBadge({ p }: { p: Posting }) {
  if (!p.verdict) return <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-xs text-muted-foreground">not scored</span>;
  const tone = {
    match: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    maybe: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    no: "bg-muted text-muted-foreground",
  }[p.verdict];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium tabular-nums", tone)}>
      {p.verdict} · {p.score}
    </span>
  );
}
