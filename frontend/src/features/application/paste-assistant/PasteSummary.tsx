import { TriangleAlert } from "lucide-react";
import type { PasteSummaryCounts } from "./paste";

export function PasteSummary({ summary }: { summary: PasteSummaryCounts }) {
  return (
    <div className="space-y-2 text-sm">
      <div>
        Will {[
          summary.creates && `create ${summary.creates} application(s)`,
          summary.updates && `update ${summary.updates}`,
          summary.fills && `fill ${summary.fills} empty field(s)`,
          summary.appends && `add to ${summary.appends}`,
        ].filter(Boolean).join(", ") || "change nothing"}.
      </div>
      {summary.overwrites.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4 text-amber-600" /> You will modify existing data:</div>
          <ul className="mt-1 list-disc pl-6">{summary.overwrites.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
