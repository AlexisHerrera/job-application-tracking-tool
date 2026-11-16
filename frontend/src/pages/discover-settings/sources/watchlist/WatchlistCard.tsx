import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { DiscoveryState } from "@/api/discovery";
import { Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorText } from "@/lib/errors";
import { useAsync } from "@/lib/useAsync";
import { SettingsCard } from "@/pages/discover-settings/SettingsCard";
import { AddCompanyForm } from "./AddCompanyForm";
import { WATCH_PAGE_SIZE } from "./constants";
import { WatchlistFilters, type WatchFilter } from "./WatchlistFilters";
import { WatchlistRow } from "./WatchlistRow";
import { WatchlistSummary } from "./WatchlistSummary";

/** The company boards each run reads, as a table. */
export function WatchlistCard({ state, onChange }: { state: DiscoveryState; onChange: () => void }) {
  const [filter, setFilterState] = useState<WatchFilter>({ q: "", ats: "", status: "", sort: "name" });
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const params = Object.fromEntries(Object.entries({ ...filter, limit: String(WATCH_PAGE_SIZE), offset: String(offset) }).filter(([, v]) => v !== ""));
  const page = useAsync(() => api.watchlist(params), [JSON.stringify(params)]);
  const setFilter = (f: WatchFilter) => {
    setFilterState(f);
    setOffset(0);
  };

  async function toggle(id: string, enabled: boolean) {
    setBusy(id);
    try {
      await api.updateWatched(id, { enabled });
      await page.reload();
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
    setBusy(null);
  }

  const data = page.data;
  const reloadAll = () => {
    void page.reload();
    onChange();
  };
  return (
    <SettingsCard title="Company boards" hint="Each run reads the public job board of every watched company and keeps the engineering roles in your locations. Free, no key needed. A board that answers 404 is turned off.">
      <WatchlistSummary state={state} onChange={reloadAll} />
      <AddCompanyForm onAdded={reloadAll} />
      <WatchlistFilters filter={filter} onChange={setFilter} counts={data?.counts} />
      {!data ? (
        <Loading error={page.error} loading={page.loading} />
      ) : data.companies.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{state.companies.total === 0 ? "No companies watched yet." : "No company matches."}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"><span className="sr-only">On</span></TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Board</TableHead>
                <TableHead className="text-right" title="Engineering roles in your locations / every job on the board">Roles</TableHead>
                <TableHead>Last read</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.companies.map((c) => <WatchlistRow key={c.id} c={c} busy={busy === c.id} onToggle={(on) => void toggle(c.id, on)} />)}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">{offset + 1}–{offset + data.companies.length} of {data.total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0 || page.loading} onClick={() => setOffset(Math.max(0, offset - WATCH_PAGE_SIZE))}>Previous</Button>
              <Button size="sm" variant="outline" disabled={offset + WATCH_PAGE_SIZE >= data.total || page.loading} onClick={() => setOffset(offset + WATCH_PAGE_SIZE)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
