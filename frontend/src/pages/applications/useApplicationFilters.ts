import { useMemo } from "react";
import type { Application, FlowData, Status } from "@/api";
import { inFlow } from "@/lib/flow";
import { ACTIVE_STATUSES } from "@/lib/status";
import { fold } from "@/lib/text";

export type StatusFilter = "all" | "active" | Status;

export function useApplicationFilters(
  data: Application[] | null,
  flowData: FlowData | null,
  { q, status, reviewOnly, flow }: { q: string; status: StatusFilter; reviewOnly: boolean; flow: string | null },
) {
  // Search, "to review" and the chart's selection apply to both views; the status chips only to the list.
  const searched = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (data ?? []).filter((a) => {
      if (reviewOnly && !a.needs_review) return false;
      if (flow && !inFlow(flowData?.paths[a.id], flow)) return false;
      const h = fold(`${a.company} ${a.role_title} ${a.location ?? ""} ${a.stack.join(" ")}`);
      return words.every((w) => h.includes(w));
    });
  }, [data, q, reviewOnly, flow, flowData]);
  const counts = useMemo(() => {
    const c = new Map<StatusFilter, number>([["all", searched.length], ["active", 0]]);
    for (const a of searched) {
      c.set(a.status, (c.get(a.status) ?? 0) + 1);
      if (ACTIVE_STATUSES.has(a.status)) c.set("active", c.get("active")! + 1);
    }
    return c;
  }, [searched]);
  const listed = searched.filter((a) => status === "all" || (status === "active" ? ACTIVE_STATUSES.has(a.status) : a.status === status));
  return { searched, counts, listed };
}
