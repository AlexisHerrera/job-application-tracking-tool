import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { DiscoveryState } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/errors";
import { timeAgo } from "@/lib/format";

/** The watchlist in numbers, the monthly directory scan, and loading the starting list. */
export function WatchlistSummary({ state, onChange }: { state: DiscoveryState; onChange: () => void }) {
  const c = state.companies;
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const r = await api.seedDiscovery();
      toast.success(`Added ${r.added.companies} compan${r.added.companies === 1 ? "y" : "ies"} and ${r.added.searches} search${r.added.searches === 1 ? "" : "es"}.`);
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
    setLoading(false);
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
      <div className="space-y-0.5">
        {c.total > 0 && (
          <p>
            <span className="font-medium text-foreground">{c.enabled} watched</span>
            {c.last_checked_at ? ` · last read ${timeAgo(c.last_checked_at)}: ${c.jobs_kept} matching role${c.jobs_kept === 1 ? "" : "s"} at ${c.with_jobs} compan${c.with_jobs === 1 ? "y" : "ies"}` : " · not read yet: run a collection"}
          </p>
        )}
        <p>
          {c.last_scan_at ? `Board directory scanned for new companies ${timeAgo(c.last_scan_at)}.` : "Board directory not scanned for new companies yet."} Worth doing monthly: <code>jobtracker discover companies scan seeds/ats_directory_2026-08.csv</code>
        </p>
      </div>
      <Button size="sm" variant="outline" disabled={loading} onClick={load} title="Adds the starting list of about 450 companies that had engineering roles in Latin America, and any default search that's missing. Keeps what you already have.">
        <Plus /> {c.total === 0 ? "Load the starting watchlist" : "Add missing defaults"}
      </Button>
    </div>
  );
}
