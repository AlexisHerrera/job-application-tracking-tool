import type { Ats, WatchSort, WatchStatus } from "@/api/discoverySettings";
import { TextFilter } from "@/components/TextFilter";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { ATS_LABELS, SORT_LABELS, STATUS_LABELS } from "./constants";

export interface WatchFilter {
  q: string;
  ats: Ats | "";
  status: WatchStatus | "";
  sort: WatchSort;
}

/** Search, ATS, status (with counts) and sort for the watchlist. */
export function WatchlistFilters({ filter, onChange, counts }: { filter: WatchFilter; onChange: (f: WatchFilter) => void; counts?: Record<WatchStatus, number> }) {
  const set = (patch: Partial<WatchFilter>) => onChange({ ...filter, ...patch });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <TextFilter icon className="min-w-48 flex-1" value={filter.q} onChange={(q) => set({ q })} placeholder="Find a company or slug" />
        <NativeSelect size="sm" value={filter.ats} onChange={(e) => set({ ats: e.target.value as Ats | "" })} aria-label="ATS">
          <NativeSelectOption value="">Every ATS</NativeSelectOption>
          {Object.entries(ATS_LABELS).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect size="sm" value={filter.sort} onChange={(e) => set({ sort: e.target.value as WatchSort })} aria-label="Sort">
          {Object.entries(SORT_LABELS).map(([v, l]) => <NativeSelectOption key={v} value={v}>Sort: {l}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
        {(["", ...Object.keys(STATUS_LABELS)] as (WatchStatus | "")[]).map((s) => {
          const n = s && counts ? counts[s] : null;
          if (s && n === 0 && filter.status !== s) return null;
          return (
            <button
              key={s || "all"}
              type="button"
              aria-pressed={filter.status === s}
              onClick={() => set({ status: s })}
              className={cn("h-7 rounded-md border px-2.5 text-xs", filter.status === s ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted")}
            >
              {s ? STATUS_LABELS[s] : "All"}
              {n !== null && <span className="ml-1 tabular-nums">{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
