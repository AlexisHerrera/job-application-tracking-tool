// Discover's criteria (plan §21, round 6): what the AI looks for, and the rules that hide postings
// before it. One tab each, the tab in the URL.
import { api } from "@/api/client";
import { Loading, PageHeader } from "@/components/common";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDiscoveryStatus } from "@/features/discovery/discoveryStatus";
import { useAsync } from "@/lib/useAsync";
import { useSearchParamsPatch } from "@/lib/useSearchParamsPatch";
import { CriteriaTab } from "./criteria/CriteriaTab";
import { RulesTab } from "./rules/RulesTab";

const TABS = ["criteria", "rules"] as const;
type Tab = (typeof TABS)[number];

// Both tabs stay mounted while hidden, so switching tabs keeps unsaved edits.
const KEEP = "data-[state=inactive]:hidden";

export default function DiscoverCriteriaPage() {
  const [params, patch] = useSearchParamsPatch();
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "criteria";
  const state = useAsync(api.discoverySettings);
  const status = useDiscoveryStatus();
  const s = state.data;
  const open = (t: Tab) => patch({ tab: t === "criteria" ? null : t });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Criteria" description="What the AI looks for, and the rules that hide postings before it." />
      {!s ? (
        <Loading error={state.error} loading={state.loading} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => open(v as Tab)}>
          <TabsList className="mb-2">
            <TabsTrigger value="criteria">Criteria</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>
          <TabsContent value="criteria" forceMount className={KEEP}>
            <CriteriaTab state={s} onSaved={state.setData} onReload={() => void state.reload()} onOpenRules={() => open("rules")} />
          </TabsContent>
          <TabsContent value="rules" forceMount className={KEEP}>
            {/* Saving the rules hides or brings back stored postings: the Review count changes. */}
            <RulesTab state={s} onSaved={(saved) => { state.setData(saved); status.refresh(); }} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
