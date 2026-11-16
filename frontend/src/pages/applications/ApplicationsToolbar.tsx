import { KanbanSquare, List, Search } from "lucide-react";
import type { FlowData } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ParamsPatch } from "@/lib/useSearchParamsPatch";
import { FlowFilterChip } from "./FlowFilterChip";

export function ApplicationsToolbar({
  view, onViewChange, q, reviewOnly, flow, flowData, set,
}: {
  view: string;
  onViewChange: (v: string) => void;
  q: string;
  reviewOnly: boolean;
  flow: string | null;
  flowData: FlowData | null;
  set: (patch: ParamsPatch) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={onViewChange} aria-label="View">
        <ToggleGroupItem value="board" aria-label="Board"><KanbanSquare /> Board</ToggleGroupItem>
        <ToggleGroupItem value="all" aria-label="All, as a list"><List /> All</ToggleGroupItem>
      </ToggleGroup>
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" placeholder="Search company, role, stack…" value={q} onChange={(e) => set({ q: e.target.value || null })} className="pl-8" />
      </div>
      <Button variant={reviewOnly ? "secondary" : "ghost"} size="sm" aria-pressed={reviewOnly} onClick={() => set({ needs_review: reviewOnly ? null : "true" })}>
        Only to review
      </Button>
      {flow && <FlowFilterChip flow={flow} flowData={flowData} onClear={() => set({ flow: null })} />}
    </div>
  );
}
