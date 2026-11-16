import { Waypoints, X } from "lucide-react";
import type { FlowData } from "@/api/dashboard";
import { flowLabel } from "@/lib/flow";

export function FlowFilterChip({ flow, flowData, onClear }: { flow: string; flowData: FlowData | null; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 pr-1 pl-2.5 text-xs font-medium">
      <Waypoints className="size-3.5 text-muted-foreground" />
      {flowData ? flowLabel(flowData, flow) : "From the chart"}
      <button type="button" onClick={onClear} aria-label="Clear the chart filter" className="rounded-full p-0.5 hover:bg-muted">
        <X className="size-3.5" />
      </button>
    </span>
  );
}
