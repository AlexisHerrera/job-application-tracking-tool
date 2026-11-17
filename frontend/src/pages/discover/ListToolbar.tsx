import { Layers, LayoutList, SlidersHorizontal } from "lucide-react";
import type { PostingPage } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VIEWS } from "./constants";
import { activeFilters, isReview, type StatusFilter, type View } from "./query";

/** One by one or list, the verdict toggle, status, sort, and the button that opens the filters. */
export function ListToolbar({ params, counts, set, filtersOpen, onToggleFilters }: { params: URLSearchParams; counts: PostingPage["counts"] | undefined; set: (key: string, value: string | null) => void; filtersOpen: boolean; onToggleFilters: () => void }) {
  const view = (params.get("view") ?? "all") as View;
  const status = (params.get("status") ?? "open") as StatusFilter;
  const active = activeFilters(params);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" value={isReview(params) ? "review" : "list"} onValueChange={(v) => v && set("layout", v === "list" ? "list" : null)} aria-label="Layout">
        <ToggleGroupItem value="review" title="One posting at a time"><Layers /> One by one</ToggleGroupItem>
        <ToggleGroupItem value="list" title="All of them in a list"><LayoutList /> List</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" variant="outline" size="sm" className="max-w-full overflow-x-auto" value={view} onValueChange={(v) => v && set("view", v === "all" ? null : v)} aria-label="Verdict">
        {VIEWS.map((v) => (
          <ToggleGroupItem key={v.value} value={v.value}>
            {v.label}
            {v.value === "hidden" && counts ? ` · ${counts.hidden}` : ""}
            {v.value === "unscored" && counts && counts.unscored ? ` · ${counts.unscored}` : ""}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <NativeSelect size="sm" value={status} onChange={(e) => set("status", e.target.value === "open" ? null : e.target.value)} aria-label="Status">
        <NativeSelectOption value="open">To look at</NativeSelectOption>
        <NativeSelectOption value="interested">Saved for later</NativeSelectOption>
        <NativeSelectOption value="applied">Applied</NativeSelectOption>
        <NativeSelectOption value="dismissed">Discarded</NativeSelectOption>
        <NativeSelectOption value="any">Any status</NativeSelectOption>
      </NativeSelect>
      <NativeSelect size="sm" value={params.get("sort") ?? "score"} onChange={(e) => set("sort", e.target.value === "score" ? null : e.target.value)} aria-label="Sort">
        <NativeSelectOption value="score">Best fit first</NativeSelectOption>
        <NativeSelectOption value="posted">Newest first</NativeSelectOption>
        <NativeSelectOption value="salary">Best paid first</NativeSelectOption>
      </NativeSelect>
      <Button size="sm" variant={active > 0 ? "secondary" : "ghost"} className="ml-auto" aria-expanded={filtersOpen} onClick={onToggleFilters}>
        <SlidersHorizontal /> Filters{active > 0 && ` · ${active}`}
      </Button>
    </div>
  );
}
