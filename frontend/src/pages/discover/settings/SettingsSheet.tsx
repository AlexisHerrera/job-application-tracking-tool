import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { type DiscoveryRules, type DiscoveryState } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { LIST_FIELDS } from "./constants";
import { RulesEditor } from "./RulesEditor";
import { SearchesSection } from "./SearchesSection";
import { WatchlistSection } from "./WatchlistSection";

/** Criteria, rules and searches. */
export function SettingsSheet({
  open,
  onOpenChange,
  state,
  onSaved,
  working,
  onRescore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  state: DiscoveryState;
  onSaved: () => void;
  working: boolean;
  onRescore: (includeHidden: boolean) => void;
}) {
  const [criteria, setCriteria] = useState(state.criteria);
  const [rules, setRules] = useState<DiscoveryRules>(state.rules);
  const [lists, setLists] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [withHidden, setWithHidden] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCriteria(state.criteria);
    setRules(state.rules);
    setLists(Object.fromEntries(LIST_FIELDS.map((f) => [f.key, (state.rules[f.key] as string[]).join("\n")])));
  }, [open, state]);

  async function save() {
    setSaving(true);
    try {
      const parsed = Object.fromEntries(LIST_FIELDS.map((f) => [f.key, (lists[f.key] ?? "").split("\n").map((l) => l.trim()).filter(Boolean)]));
      await api.saveDiscoverySettings({ criteria, rules: { ...rules, ...parsed } });
      toast.success("Saved. New postings use it from the next run.");
      onSaved();
    } catch (e) {
      toast.error(errorText(e));
    }
    setSaving(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Criteria & searches</SheetTitle>
          <SheetDescription>The AI reads the criteria for every new posting. The rules hide postings before any AI call.</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-8">
          <section className="space-y-2">
            <Label htmlFor="criteria">What you're looking for</Label>
            <Textarea id="criteria" rows={16} value={criteria} onChange={(e) => setCriteria(e.target.value)} className="font-mono text-xs" />
          </section>

          <RulesEditor rules={rules} onRulesChange={setRules} lists={lists} onListsChange={setLists} />

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save criteria & rules"}</Button>
            {state.can_run && (
              <>
                <Button size="sm" variant="outline" disabled={working} onClick={() => onRescore(withHidden)} title="Scores the postings from the last 3 weeks again with the saved criteria (paid AI calls, about $0.0005 each). Doesn't run the searches, so no JSearch requests.">
                  <RefreshCw /> Re-score recent
                </Button>
                <label className="flex items-center gap-1.5 text-xs" title="Also score the postings the rules hid (not duplicates). They stay hidden, but you'll see their verdict and can filter them.">
                  <Checkbox checked={withHidden} onCheckedChange={(c) => setWithHidden(c === true)} /> hidden ones too
                </label>
              </>
            )}
          </div>

          <WatchlistSection state={state} onChange={onSaved} />

          <SearchesSection searches={state.searches} jsearchConfigured={state.jsearch_configured} onChange={onSaved} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
