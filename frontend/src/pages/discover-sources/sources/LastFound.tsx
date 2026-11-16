import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

/** When a source last brought anything. With `staleDays`, it turns amber once that's longer ago
 * (or never, though it was read): a search that keeps coming back empty may be broken. */
export function LastFound({ at, readAt, staleDays }: { at: string | null; readAt: string | null; staleDays?: number }) {
  if (!readAt) return <span className="text-muted-foreground">–</span>;
  const stale = staleDays !== undefined && (!at || Date.now() - new Date(at).getTime() > staleDays * DAY_MS);
  return <span className={cn(stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{at ? timeAgo(at) : "never"}</span>;
}
