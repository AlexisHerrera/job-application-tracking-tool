import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorText, type DiscoverySearch } from "@/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AddSearchForm } from "./AddSearchForm";
import { paramsSummary } from "./paramsSummary";

/** The saved searches (enable, delete) and the form to add one. */
export function SearchesSection({ searches, jsearchConfigured, onChange }: { searches: DiscoverySearch[]; jsearchConfigured: boolean; onChange: () => void }) {
  const enabledJsearch = searches.filter((x) => x.enabled && x.source === "jsearch").length;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Searches</h3>
        <p className="text-xs text-muted-foreground">
          remoteyeah feeds, getonbrd categories and Workable searches are free.
          {enabledJsearch > 0 && ` ${enabledJsearch} JSearch search${enabledJsearch === 1 ? "" : "es"} on: about ${enabledJsearch * 30} of the free 200 requests a month at one run a day.`}
          {enabledJsearch > 0 && !jsearchConfigured && " JSEARCH_API_KEY isn't set, so JSearch searches are skipped."}
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {searches.map((x) => (
          <li key={x.id} className="flex items-center gap-3 px-3 py-2">
            <Checkbox checked={x.enabled} onCheckedChange={(c) => run(() => api.updateSearch(x.id, { enabled: c === true }))} aria-label={`Enable ${x.label}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{x.label}</div>
              <div className="truncate text-xs text-muted-foreground">{x.source} · {paramsSummary(x)}</div>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${x.label}`} onClick={() => run(() => api.deleteSearch(x.id))}><Trash2 /></Button>
          </li>
        ))}
      </ul>
      <AddSearchForm run={run} />
    </section>
  );
}
