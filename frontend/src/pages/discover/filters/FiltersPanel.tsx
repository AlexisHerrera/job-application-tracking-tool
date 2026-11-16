import { X } from "lucide-react";
import type { Facet, PostingPage } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { COMPANY_SIZE, EMPLOYER, FILTER_PARAMS, LOCATION_FIT, POSTED, SECTOR, SENIORITY, WORK_MODE } from "@/pages/discover/constants";
import { activeFilters, techsOf } from "@/pages/discover/query";
import { FacetSelect } from "./FacetSelect";
import { SourceSelect } from "./SourceSelect";
import { TechPicker } from "./TechPicker";
import { TextFilter } from "@/components/TextFilter";

/** Search and filters. */
export function FiltersPanel({
  params,
  set,
  update,
  facets,
}: {
  params: URLSearchParams;
  set: (key: string, value: string | null) => void;
  update: (changes: Record<string, string | null>) => void;
  facets: PostingPage["facets"] | undefined;
}) {
  const active = activeFilters(params);
  const facet = (key: string, all: string, options: Facet | undefined, names: Record<string, string>) => (
    <FacetSelect value={params.get(key) ?? ""} onChange={(v) => set(key, v || null)} all={all} options={options ?? []} names={names} />
  );
  const clear = () => update(Object.fromEntries([...Object.keys(FILTER_PARAMS), "ai"].map((k) => [k, null])));

  return (
    <div className="mb-4 space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap gap-2">
        <TextFilter value={params.get("q") ?? ""} onChange={(v) => set("q", v || null)} placeholder="Title or company" className="min-w-48 flex-[2]" icon />
        <TextFilter value={params.get("loc") ?? ""} onChange={(v) => set("loc", v || null)} placeholder="Location, e.g. Buenos Aires" className="min-w-44 flex-1" />
        <TextFilter
          value={params.get("salary") ?? ""}
          onChange={(v) => set("salary", v.replace(/\D/g, "") || null)}
          placeholder="Min salary, USD/yr"
          className="w-40"
          inputMode="numeric"
          title="Only postings that state a salary (in USD, or converted to a year) with a top of at least this"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FacetSelect value={params.get("pub") ?? ""} onChange={(v) => set("pub", v || null)} all="Any job board" options={facets?.publisher ?? []} />
        <SourceSelect value={params.get("source") ?? ""} onChange={(v) => set("source", v || null)} />
        {facet("sen", "Any seniority", facets?.seniority, SENIORITY)}
        <TechPicker selected={techsOf(params)} options={facets?.technologies ?? []} onChange={(t) => set("tech", t.join(",") || null)} />
        {facet("size", "Any company size", facets?.company_size, COMPANY_SIZE)}
        {facet("sector", "Any sector", facets?.sector, SECTOR)}
        {facet("mode", "Remote, hybrid or on-site", facets?.work_mode, WORK_MODE)}
        {facet("fit", "Any location fit", facets?.location_fit, LOCATION_FIT)}
        {facet("emp", "Any employer", facets?.employer_kind, EMPLOYER)}
        <NativeSelect size="sm" value={params.get("posted") ?? ""} onChange={(e) => set("posted", e.target.value || null)} aria-label="Posted" className={cn(params.get("posted") && "[&_select]:border-primary")}>
          {POSTED.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={params.get("ai") === "1"} onCheckedChange={(c) => set("ai", c === true ? "1" : null)} /> AI roles
        </label>
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={clear} className="text-muted-foreground">
            <X /> Clear {active} filter{active === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </div>
  );
}
