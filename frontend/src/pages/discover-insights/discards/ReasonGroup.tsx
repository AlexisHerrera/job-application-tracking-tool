import type { DiscardReasonRow } from "@/api/discoveryInsights";
import { ReasonRow } from "./ReasonRow";

/** A titled list of discard reasons, bars on one scale with the other group's. */
export function ReasonGroup({ title, hint, rows, max, open, onToggle }: { title: string; hint: string; rows: DiscardReasonRow[]; max: number; open: Set<string>; onToggle: (reason: string) => void }) {
  return (
    <section>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2 divide-y">
        {rows.map((r) => <ReasonRow key={r.reason} row={r} scale={r.count / max} open={open.has(r.reason)} onToggle={() => onToggle(r.reason)} />)}
      </div>
    </section>
  );
}
