import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { DiscoveryState } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RunProgressPanel } from "@/features/discovery/progress/RunProgressPanel";
import { useDiscoveryJob } from "@/features/discovery/useDiscoveryJob";

/** Re-score recent: the saved criteria applied to the postings of the last 3 weeks (paid). */
export function RescoreCard({ state, unsaved, onDone }: { state: DiscoveryState; unsaved: boolean; onDone: () => void }) {
  const [withHidden, setWithHidden] = useState(false);
  const { working, progress, start, panelKind, collectOnly } = useDiscoveryJob(onDone);
  if (!state.can_run) return null;
  return (
    <section className="space-y-2 rounded-lg border bg-card p-3">
      <h3 className="text-sm font-medium">Apply to recent postings</h3>
      <p className="text-xs text-muted-foreground">
        New postings are scored with the saved criteria. Re-scoring runs the AI again on the last 3 weeks' postings (paid, about $0.0005 each); it doesn't run the searches.
      </p>
      {working && <RunProgressPanel p={progress} kind={panelKind} collectOnly={collectOnly} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={working || unsaved || !state.llm_configured} onClick={() => void start({ kind: "rescore", includeHidden: withHidden })}>
          <RefreshCw /> {working ? "Re-scoring…" : "Re-score recent"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs" title="Also score the postings the rules hid (not duplicates). They stay hidden, but you'll see their verdict and can filter them.">
          <Checkbox checked={withHidden} onCheckedChange={(c) => setWithHidden(c === true)} /> hidden ones too
        </label>
      </div>
      {unsaved && <p className="text-xs text-muted-foreground">Save first: re-scoring uses the saved criteria.</p>}
      {!state.llm_configured && <p className="text-xs text-muted-foreground">ANTHROPIC_API_KEY isn't set.</p>}
    </section>
  );
}
