import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { type DiscoverySearch } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingsCard } from "@/features/discovery/SettingsCard";
import { AddSearchForm } from "./AddSearchForm";
import { paramsSummary } from "./paramsSummary";

/** The saved searches (enable, delete) and the form to add one. */
export function SearchesSection({ searches, onChange }: { searches: DiscoverySearch[]; onChange: () => void }) {
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const hint = "remoteyeah feeds, getonbrd categories and Workable searches. All free.";
  const on = searches.filter((x) => x.enabled).length;

  return (
    <SettingsCard title="Saved searches" hint={hint} aside={<span className="tabular-nums">{on} of {searches.length} on</span>}>
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
    </SettingsCard>
  );
}
