import { timeAgo } from "@/lib/format";

/** How a search's or a board's last fetch went: when, or that it failed (and how many times in a
 * row), with the error on hover. */
export function FetchStatus({ at, status, failStreak }: { at: string | null; status: string | null; failStreak: number }) {
  if (!at) return <span className="text-muted-foreground">not read yet</span>;
  const when = timeAgo(at);
  if (status === "gone") return <span className="text-destructive">board gone · {when}</span>;
  if (status && status !== "ok") {
    const failed = failStreak > 1 ? `failed ${failStreak}× in a row` : "failed";
    return <span className="text-destructive" title={status}>{failed} · {when}</span>;
  }
  return <span className="text-muted-foreground">{when}</span>;
}
