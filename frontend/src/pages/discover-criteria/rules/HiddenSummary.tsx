import type { RuleHits } from "@/api/discoverySettings";
import { HIDE_REASON_LABELS } from "@/features/discovery/hideReasons";

/** Every hide reason among the stored postings, biggest first ("title: java" ones grouped). */
function grouped(reasons: Record<string, number>): [string, number][] {
  const out: Record<string, number> = {};
  for (const [reason, n] of Object.entries(reasons)) {
    const key = reason.startsWith("title: ") ? "title" : reason;
    out[key] = (out[key] ?? 0) + n;
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}

/** What the rules hide today, in numbers. */
export function HiddenSummary({ hits }: { hits: RuleHits | null }) {
  if (!hits) return <p className="text-xs text-muted-foreground">Counting what the rules hid…</p>;
  const rows = grouped(hits.reasons);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium">{total.toLocaleString()} stored postings hidden</h3>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
        Each posting counts once, for the first rule that hid it when it was stored or last checked. The numbers on the chips below are the same counts per entry.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing hidden yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {rows.map(([key, n]) => (
            <li key={key} className="text-xs">
              <span className="block text-base font-semibold tabular-nums">{n.toLocaleString()}</span>
              <span className="text-muted-foreground">{HIDE_REASON_LABELS[key] ?? key}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
