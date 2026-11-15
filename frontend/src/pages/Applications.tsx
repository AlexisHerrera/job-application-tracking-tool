import { useMemo, useState } from "react";
import { KanbanSquare, List, Plus, Search, Sparkles, Waypoints, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { api, errorText, type Application, type Stage, type Status } from "../api";
import { fold } from "@/lib/text";
import { useSearchParamsPatch } from "@/lib/useSearchParamsPatch";
import { ApplicationView } from "@/features/application/ApplicationView/ApplicationView";
import { useCampaign } from "../campaign";
import { Empty, Loading, PageHeader, StatusDot } from "../components/common";
import { flowLabel, inFlow } from "@/lib/flow";
import { ACTIVE_STATUSES, STATUS_META, STATUS_ORDER } from "../lib/status";
import { useRefresh } from "../lib/refresh";
import { ReviewDialog } from "../ReviewDialog";
import { useAsync } from "../useAsync";
import { AllTable } from "./applications/AllTable";
import { Board } from "./applications/Board";

const VIEW_KEY = "jobtracker.view";

function storedView(): string | null {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

type Filter = "all" | "active" | Status;

export default function Applications() {
  const [params, set] = useSearchParamsPatch();
  const view = (params.get("view") ?? storedView()) === "all" ? "all" : "board";
  const q = params.get("q") ?? "";
  const status = (params.get("status") ?? "all") as Filter;
  const reviewOnly = params.get("needs_review") === "true";
  const flow = params.get("flow"); // a node or flow of the dashboard's chart
  const openId = params.get("open");
  const [reviewing, setReviewing] = useState(false);

  const { selected: campaign } = useCampaign();
  const { bump } = useRefresh();
  const { data, error, loading, setData } = useAsync(() => api.applications({ campaign }), [campaign]);
  const flowData = useAsync(() => (flow ? api.stats(campaign).then((s) => s.flow) : Promise.resolve(null)), [campaign, !!flow]).data;

  const setView = (v: string) => {
    if (!v) return;
    set({ view: v });
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };

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
    const c = new Map<Filter, number>([["all", searched.length], ["active", 0]]);
    for (const a of searched) {
      c.set(a.status, (c.get(a.status) ?? 0) + 1);
      if (ACTIVE_STATUSES.has(a.status)) c.set("active", c.get("active")! + 1);
    }
    return c;
  }, [searched]);
  const listed = searched.filter((a) => status === "all" || (status === "active" ? ACTIVE_STATUSES.has(a.status) : a.status === status));
  const toReview = (data ?? []).filter((a) => a.needs_review).length;

  async function move(app: Application, stage: Stage) {
    const before = data;
    setData((data ?? []).map((a) => (a.id === app.id ? { ...a, status: stage, current_stage: stage } : a)));
    try {
      await api.changeStage(app.id, { stage });
      toast.success(`${app.company} → ${STATUS_META[stage].label}`, {
        action: {
          label: "Undo",
          onClick: () => void api.changeStage(app.id, { stage: app.current_stage, note: "undo" }).then(bump, (e) => toast.error(errorText(e))),
        },
      });
    } catch (e) {
      setData(before);
      toast.error(errorText(e));
    }
    bump();
  }

  async function confirm(app: Application) {
    setData((data ?? []).map((a) => (a.id === app.id ? { ...a, needs_review: false } : a)));
    try {
      await api.markReviewed(app.id);
      toast.success(`${app.company} confirmed`);
    } catch (e) {
      toast.error(errorText(e));
    }
    bump();
  }

  const filters: Filter[] = ["all", "active", ...STATUS_ORDER];

  return (
    <>
      <PageHeader
        title="Applications"
        description={data ? `${data.length} in this campaign · ${counts.get("active") ?? 0} active` : undefined}
        actions={
          <>
            {toReview > 0 && (
              <Button variant="outline" size="sm" onClick={() => setReviewing(true)}>
                <Sparkles className="text-amber-500" /> Review {toReview}
              </Button>
            )}
            <Button asChild size="sm"><Link to="/add"><Plus /> New</Link></Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={setView} aria-label="View">
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
        {flow && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 pr-1 pl-2.5 text-xs font-medium">
            <Waypoints className="size-3.5 text-muted-foreground" />
            {flowData ? flowLabel(flowData, flow) : "From the chart"}
            <button type="button" onClick={() => set({ flow: null })} aria-label="Clear the chart filter" className="rounded-full p-0.5 hover:bg-muted">
              <X className="size-3.5" />
            </button>
          </span>
        )}
      </div>

      {view === "all" && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {filters.map((f) => {
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
      )}

      <Loading error={error} loading={loading && !data} />
      {data && data.length === 0 && <Empty>No applications in this campaign yet. <Link to="/add" className="text-primary underline-offset-4 hover:underline">Add one</Link></Empty>}
      {data && data.length > 0 && view === "board" && (
        <Board apps={searched} onOpen={(id) => set({ open: id })} onMove={move} onConfirm={confirm} />
      )}
      {data && data.length > 0 && view === "all" && (
        listed.length ? <AllTable apps={listed} onOpen={(id) => set({ open: id })} /> : <Empty>Nothing matches these filters.</Empty>
      )}

      <Sheet open={!!openId} onOpenChange={(o) => !o && set({ open: null })}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-2xl">
          <SheetTitle className="sr-only">Application</SheetTitle>
          {openId && <ApplicationView key={openId} id={openId} inSheet onDeleted={() => set({ open: null })} />}
        </SheetContent>
      </Sheet>
      <ReviewDialog open={reviewing} onOpenChange={setReviewing} campaign={campaign} />
    </>
  );
}
