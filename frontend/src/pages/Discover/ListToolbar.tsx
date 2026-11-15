import type { PostingPage } from "@/api";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VIEWS } from "./constants";
import type { StatusFilter, View } from "./query";

/** Verdict toggle, status and sort. */
export function ListToolbar({ params, counts, set }: { params: URLSearchParams; counts: PostingPage["counts"] | undefined; set: (key: string, value: string | null) => void }) {
  const view = (params.get("view") ?? "all") as View;
  const status = (params.get("status") ?? "open") as StatusFilter;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && set("view", v === "all" ? null : v)} aria-label="Verdict">
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
        <NativeSelectOption value="interested">Interested</NativeSelectOption>
        <NativeSelectOption value="applied">Applied</NativeSelectOption>
        <NativeSelectOption value="dismissed">Not for me</NativeSelectOption>
        <NativeSelectOption value="any">Any status</NativeSelectOption>
      </NativeSelect>
      <NativeSelect size="sm" value={params.get("sort") ?? "score"} onChange={(e) => set("sort", e.target.value === "score" ? null : e.target.value)} aria-label="Sort">
        <NativeSelectOption value="score">Best fit first</NativeSelectOption>
        <NativeSelectOption value="posted">Newest first</NativeSelectOption>
        <NativeSelectOption value="salary">Best paid first</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}
