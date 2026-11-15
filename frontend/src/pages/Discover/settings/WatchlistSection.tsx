import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api, errorText, timeAgo, type DiscoveryState } from "@/api";
import { Button } from "@/components/ui/button";

/** The watched company job boards, in numbers, and loading the starting list. */
export function WatchlistSection({ state, onChange }: { state: DiscoveryState; onChange: () => void }) {
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
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Company boards</h3>
      <p className="text-xs text-muted-foreground">
        Each run reads the public job board of every watched company and keeps the engineering roles in your locations. It's free and needs no key.
      </p>
      <div className="rounded-lg border px-3 py-2 text-sm">
        {c.total === 0 ? (
          "No companies watched yet."
        ) : (
          <>
            <div>
              {c.enabled} compan{c.enabled === 1 ? "y" : "ies"} watched
              <span className="text-muted-foreground"> · Greenhouse {c.by_ats.greenhouse} · Ashby {c.by_ats.ashby} · Lever {c.by_ats.lever}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {c.last_checked_at ? `Last read ${timeAgo(c.last_checked_at)}: ${c.jobs_kept} matching role${c.jobs_kept === 1 ? "" : "s"} at ${c.with_jobs} compan${c.with_jobs === 1 ? "y" : "ies"}` : "Not read yet: run a collection."}
              {c.total > c.enabled && ` · ${c.total - c.enabled} off (board gone)`}
            </div>
            <div className="text-xs text-muted-foreground">
              {c.last_scan_at ? `Board directory scanned for new companies ${timeAgo(c.last_scan_at)}.` : "Board directory not scanned for new companies from here yet."} Worth doing monthly: <code>jobtracker discover companies scan seeds/ats_directory_2026-08.csv</code>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={loading} onClick={load} title="Adds the starting list of about 450 companies that had engineering roles in Latin America, and any default search that's missing. Keeps what you already have.">
          <Plus /> {c.total === 0 ? "Load the starting watchlist" : "Add missing defaults"}
        </Button>
        <span className="text-xs text-muted-foreground">Add one company from a terminal: <code>jobtracker discover companies add &lt;its website or board URL&gt;</code></span>
      </div>
    </section>
  );
}
