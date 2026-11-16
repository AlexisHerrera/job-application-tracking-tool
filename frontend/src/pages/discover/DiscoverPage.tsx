// Job discovery (plan §20, §21): new openings from the saved searches and the watched companies'
// job boards, scored by the LLM against the criteria. Everything in a posting comes from the web: rendered as text, links only if http(s).
import { useState } from "react";
import { Settings2, Telescope } from "lucide-react";
import { api } from "@/api";
import { Empty, Loading, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useSearchParamsPatch, type ParamsPatch } from "@/lib/useSearchParamsPatch";
import { useAsync } from "@/lib/useAsync";
import { FiltersPanel } from "./filters/FiltersPanel";
import { ListToolbar } from "./ListToolbar";
import { PostingList } from "./postings/PostingList";
import { LastRunSummary } from "./progress/LastRunSummary";
import { RunProgressPanel } from "./progress/RunProgressPanel";
import { pageOf, queryFor, techsOf } from "./query";
import { RunButtons } from "./RunButtons";
import { SeedEmptyState } from "./SeedEmptyState";
import { SettingsSheet } from "./settings/SettingsSheet";
import { useDiscoveryJob } from "./useDiscoveryJob";

export default function DiscoverPage() {
  const [params, patch] = useSearchParamsPatch();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const state = useAsync(api.discoverySettings);
  const list = useAsync(() => api.postings(queryFor(params)), [params.toString()]);

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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Discover"
        description="New openings from your saved searches and watched companies, scored against your criteria."
        actions={
          s && (
            <>
              <RunButtons state={s} working={working} onRun={(score, collect) => void start({ kind: "run", score, collect })} />
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 /> Criteria & searches
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
          onSeeded={() => {
            reloadAll();
            setSettingsOpen(true);
          }}
        />
      ) : (
        <>
          <ListToolbar params={params} counts={data?.counts} set={set} />

          <FiltersPanel params={params} set={set} update={update} facets={data?.facets} />

          {!data ? (
            <Loading error={list.error} loading={list.loading} />
          ) : data.postings.length === 0 ? (
            <Empty icon={<Telescope className="size-8" />}>
              {data.counts.total === 0 ? "Nothing collected yet. Run the searches to fill this page." : "Nothing here with these filters."}
            </Empty>
          ) : (
            <PostingList data={data} page={page} loading={list.loading} set={set} onChange={() => void list.reload()} onBlocked={reloadAll} onTech={addTech} />
          )}
        </>
      )}

      {s && (
        <SettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          state={s}
          onSaved={reloadAll}
          working={working}
          onRescore={(includeHidden) => {
            setSettingsOpen(false);
            void start({ kind: "rescore", includeHidden });
          }}
        />
      )}
    </div>
  );
}
