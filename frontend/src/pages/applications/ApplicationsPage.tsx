import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useCampaign } from "@/campaign";
import { Empty, Loading, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useSearchParamsPatch } from "@/lib/useSearchParamsPatch";
import { ReviewDialog } from "@/ReviewDialog";
import { useAsync } from "@/useAsync";
import { ApplicationSheet } from "./ApplicationSheet";
import { ApplicationsToolbar } from "./ApplicationsToolbar";
import { Board } from "./board/Board";
import { StatusFilterChips } from "./StatusFilterChips";
import { ApplicationsTable } from "./table/ApplicationsTable";
import { useApplicationFilters, type StatusFilter } from "./useApplicationFilters";
import { useBoardActions } from "./useBoardActions";
import { saveView, storedView } from "./viewPreference";

export default function ApplicationsPage() {
  const [params, set] = useSearchParamsPatch();
  const view = (params.get("view") ?? storedView()) === "all" ? "all" : "board";
  const q = params.get("q") ?? "";
  const status = (params.get("status") ?? "all") as StatusFilter;
  const reviewOnly = params.get("needs_review") === "true";
  const flow = params.get("flow"); // a node or flow of the dashboard's chart
  const openId = params.get("open");
  const [reviewing, setReviewing] = useState(false);

  const { selected: campaign } = useCampaign();
  const { data, error, loading, setData } = useAsync(() => api.applications({ campaign }), [campaign]);
  const flowData = useAsync(() => (flow ? api.stats(campaign).then((s) => s.flow) : Promise.resolve(null)), [campaign, !!flow]).data;
  const { searched, counts, listed } = useApplicationFilters(data, flowData, { q, status, reviewOnly, flow });
  const { move, confirm } = useBoardActions(data, setData);
  const toReview = (data ?? []).filter((a) => a.needs_review).length;

  const setView = (v: string) => {
    if (!v) return;
    set({ view: v });
    saveView(v);
  };

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

      <ApplicationsToolbar view={view} onViewChange={setView} q={q} reviewOnly={reviewOnly} flow={flow} flowData={flowData} set={set} />
      {view === "all" && <StatusFilterChips status={status} counts={counts} set={set} />}

      <Loading error={error} loading={loading && !data} />
      {data && data.length === 0 && <Empty>No applications in this campaign yet. <Link to="/add" className="text-primary underline-offset-4 hover:underline">Add one</Link></Empty>}
      {data && data.length > 0 && view === "board" && (
        <Board apps={searched} onOpen={(id) => set({ open: id })} onMove={move} onConfirm={confirm} />
      )}
      {data && data.length > 0 && view === "all" && (
        listed.length ? <ApplicationsTable apps={listed} onOpen={(id) => set({ open: id })} /> : <Empty>Nothing matches these filters.</Empty>
      )}

      <ApplicationSheet openId={openId} onClose={() => set({ open: null })} />
      <ReviewDialog open={reviewing} onOpenChange={setReviewing} campaign={campaign} />
    </>
  );
}
