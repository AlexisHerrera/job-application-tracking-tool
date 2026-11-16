// Job discovery (plan §20, §21): one posting at a time by default, or the list. New openings from the saved searches and the watched companies'
// job boards, scored by the LLM against the criteria. Everything in a posting comes from the web: rendered as text, links only if http(s).
import { useState } from "react";
import { Settings2, Telescope } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { Empty, Loading, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useSearchParamsPatch, type ParamsPatch } from "@/lib/useSearchParamsPatch";
import { useAsync } from "@/lib/useAsync";
import { RunProgressPanel } from "@/features/discovery/progress/RunProgressPanel";
import { useDiscoveryJob } from "@/features/discovery/useDiscoveryJob";
import { FiltersPanel } from "./filters/FiltersPanel";
import { ListToolbar } from "./ListToolbar";
import { PostingList } from "./postings/PostingList";
import { LastRunSummary } from "./progress/LastRunSummary";
import { isReview, pageOf, queryFor, techsOf } from "./query";
import { ReviewDeck } from "./review/ReviewDeck";
import { RunButtons } from "./RunButtons";
import { SeedEmptyState } from "./SeedEmptyState";

export default function DiscoverPage() {
  const [params, patch] = useSearchParamsPatch();
  const navigate = useNavigate();
  const state = useAsync(api.discoverySettings);
  const query = queryFor(params);
  const list = useAsync(() => api.postings(query), [params.toString()]);
  const review = isReview(params);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const page = pageOf(params);
  // One setParams call per change: several in a row would each start from the same old params.
  // Any change but the page itself goes back to the first page.
  const update = (changes: ParamsPatch) => patch("page" in changes ? changes : { ...changes, page: null });
  const set = (key: string, value: string | null) => update({ [key]: value });
  const addTech = (t: string) => {
    const techs = techsOf(params);
    if (!techs.some((x) => x.toLowerCase() === t.toLowerCase())) set("tech", [...techs, t].join(","));
  };

  const reloadAll = () => {
    void state.reload();
    void list.reload();
  };
  const s = state.data;
  const data = list.data;
  const { working, progress, start, panelKind, collectOnly } = useDiscoveryJob(reloadAll);

  return (
    <div className={review ? "mx-auto max-w-6xl" : "mx-auto max-w-5xl"}>
      <PageHeader
        title="Discover"
        description="New openings from your saved searches and watched companies, scored against your criteria."
        actions={
          s && (
            <>
              <RunButtons state={s} working={working} onRun={(score, collect) => void start({ kind: "run", score, collect })} />
              <Button variant="outline" size="sm" asChild>
                <Link to="/discover/settings">
                  <Settings2 /> Settings
                </Link>
              </Button>
            </>
          )
        }
      />

      {working ? (
        <RunProgressPanel p={progress} kind={panelKind} collectOnly={collectOnly} />
      ) : (
        s && <LastRunSummary run={s.last_run} used={s.jsearch_used_this_month} cap={s.rules.jsearch_monthly_cap} jsearchOn={s.searches.some((x) => x.enabled && x.source === "jsearch")} />
      )}

      {s && s.searches.length === 0 && s.companies.total === 0 ? (
        <SeedEmptyState
          onSeeded={() => navigate("/discover/settings")}
        />
      ) : (
        <>
          <ListToolbar params={params} counts={data?.counts} set={set} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((open) => !open)} />

          {filtersOpen && <FiltersPanel params={params} set={set} update={update} facets={data?.facets} />}

          {!data ? (
            <Loading error={list.error} loading={list.loading} />
          ) : data.postings.length === 0 ? (
            <Empty icon={<Telescope className="size-8" />}>
              {data.counts.total === 0 ? "Nothing collected yet. Run the searches to fill this page." : "Nothing here with these filters."}
            </Empty>
          ) : review ? (
            <ReviewDeck data={data} query={query} onBlocked={reloadAll} onTech={addTech} />
          ) : (
            <PostingList data={data} page={page} loading={list.loading} set={set} onChange={() => void list.reload()} onBlocked={reloadAll} onTech={addTech} />
          )}
        </>
      )}

    </div>
  );
}
