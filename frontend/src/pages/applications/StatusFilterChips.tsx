import { StatusDot } from "@/components/common";
import { STATUS_META, STATUS_ORDER } from "@/lib/status";
import type { ParamsPatch } from "@/lib/useSearchParamsPatch";
import { cn } from "@/lib/utils";
import type { StatusFilter } from "./useApplicationFilters";

const FILTERS: StatusFilter[] = ["all", "active", ...STATUS_ORDER];

export function StatusFilterChips({
  status, counts, set,
}: {
  status: StatusFilter;
  counts: Map<StatusFilter, number>;
  set: (patch: ParamsPatch) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
      {FILTERS.map((f) => {
        const n = counts.get(f) ?? 0;
        return (
          <button
            key={f}
            type="button"
            aria-pressed={f === status}
            onClick={() => set({ status: f === "all" ? null : f })}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors hover:bg-muted",
              f === status && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
              n === 0 && f !== status && "text-muted-foreground",
            )}
          >
            {f !== "all" && f !== "active" && <StatusDot status={f} />}
            {f === "all" ? "All" : f === "active" ? "Active" : STATUS_META[f].label}
            <span className="tabular-nums opacity-70">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
