// Discover's settings (plan §21, round 6): what the AI looks for, the rules that hide postings
// before it, where postings come from, and the past runs. One tab each, the tab in the URL.
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { Loading, PageHeader } from "@/components/common";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAsync } from "@/lib/useAsync";
import { useSearchParamsPatch } from "@/lib/useSearchParamsPatch";
import { CriteriaTab } from "./criteria/CriteriaTab";
import { RulesTab } from "./rules/RulesTab";
import { RunsTab } from "./runs/RunsTab";
import { SourcesTab } from "./sources/SourcesTab";

const TABS = ["criteria", "rules", "sources", "runs"] as const;
type Tab = (typeof TABS)[number];

// Criteria and Rules stay mounted while hidden, so switching tabs keeps unsaved edits.
const KEEP = "data-[state=inactive]:hidden";

export default function DiscoverSettingsPage() {
  const [params, patch] = useSearchParamsPatch();
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "criteria";
  const state = useAsync(api.discoverySettings);
  const s = state.data;
  const open = (t: Tab) => patch({ tab: t === "criteria" ? null : t });
  const reload = () => void state.reload();

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/discover" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Discover
      </Link>
      <PageHeader title="Discover settings" description="What the AI looks for, the rules that hide postings before it, and where postings come from." />
      {!s ? (
        <Loading error={state.error} loading={state.loading} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => open(v as Tab)}>
          <TabsList className="mb-2">
            <TabsTrigger value="criteria">Criteria</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="sources">
              Sources <span className="text-xs text-muted-foreground tabular-nums">{s.searches.filter((x) => x.enabled).length + s.companies.enabled}</span>
            </TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
          </TabsList>
          <TabsContent value="criteria" forceMount className={KEEP}>
            <CriteriaTab state={s} onSaved={state.setData} onReload={reload} onOpenRules={() => open("rules")} />
          </TabsContent>
          <TabsContent value="rules" forceMount className={KEEP}>
            <RulesTab state={s} onSaved={state.setData} />
          </TabsContent>
          <TabsContent value="sources">
            <SourcesTab state={s} onChange={reload} />
          </TabsContent>
          <TabsContent value="runs">
            <RunsTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
