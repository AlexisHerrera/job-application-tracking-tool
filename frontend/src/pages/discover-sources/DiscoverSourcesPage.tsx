// Discover's sources (plan §21, round 6): where postings come from, and the past runs. One tab
// each, the tab in the URL.
import { api } from "@/api/client";
import { Loading, PageHeader } from "@/components/common";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAsync } from "@/lib/useAsync";
import { useSearchParamsPatch } from "@/lib/useSearchParamsPatch";
import { RunsTab } from "./runs/RunsTab";
import { SourcesTab } from "./sources/SourcesTab";

const TABS = ["sources", "runs"] as const;
type Tab = (typeof TABS)[number];

export default function DiscoverSourcesPage() {
  const [params, patch] = useSearchParamsPatch();
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "sources";
  const state = useAsync(api.discoverySettings);
  const s = state.data;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Sources" description="Where postings come from: the saved searches and the watched company boards, and how each run went." />
      {!s ? (
        <Loading error={state.error} loading={state.loading} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => patch({ tab: v === "sources" ? null : v })}>
          <TabsList className="mb-2">
            <TabsTrigger value="sources">
              Sources <span className="text-xs text-muted-foreground tabular-nums">{s.searches.filter((x) => x.enabled).length + s.companies.enabled}</span>
            </TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
          </TabsList>
          <TabsContent value="sources">
            <SourcesTab state={s} onChange={() => void state.reload()} />
          </TabsContent>
          <TabsContent value="runs">
            <RunsTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
