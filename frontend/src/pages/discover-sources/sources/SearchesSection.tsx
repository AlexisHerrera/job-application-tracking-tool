import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePending } from "@/lib/usePending";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { type DiscoverySearch } from "@/api/discovery";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettingsCard } from "@/features/discovery/SettingsCard";
import { AddSearchForm } from "./AddSearchForm";
import { SearchRow } from "./SearchRow";

/** The saved searches as a table (enable, delete, how each one's last fetch went) and the form
 * to add one. */
export function SearchesSection({ searches, onChange }: { searches: DiscoverySearch[]; onChange: () => void }) {
  const { pending, run: runPending } = usePending<"toggle" | "delete">();
  const [optimistic, setOptimistic] = useState<{ id: string; enabled?: boolean } | null>(null);
  const [saved, setSaved] = useState(new Map<string, boolean | undefined>());
  useEffect(() => {
    setSaved((previous) => {
      const next = new Map(previous);
      for (const [id, enabled] of previous) {
        const current = searches.find((search) => search.id === id);
        if (current?.enabled === enabled) next.delete(id);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [searches]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const change = (id: string, enabled?: boolean) => runPending(enabled === undefined ? "delete" : "toggle", async () => {
    setOptimistic({ id, enabled });
    try {
      if (enabled === undefined) await api.deleteSearch(id);
      else await api.updateSearch(id, { enabled });
      setSaved((all) => new Map(all).set(id, enabled));
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setOptimistic(null);
    }
  });

  const shown = searches.flatMap((x) => {
    const enabled = optimistic?.id === x.id ? optimistic.enabled : saved.has(x.id) ? saved.get(x.id) : x.enabled;
    return enabled === undefined ? [] : [{ ...x, enabled }];
  });

  const hint = "remoteyeah feeds, getonbrd categories and Workable searches. All free.";
  const on = shown.filter((x) => x.enabled).length;
  const failing = shown.filter((x) => x.enabled && x.last_status !== null && x.last_status !== "ok").length;
  const aside = (
    <>
      {failing > 0 && <span className="text-destructive tabular-nums">{failing} failing</span>}
      <span className="tabular-nums">{on} of {shown.length} on</span>
    </>
  );

  return (
    <SettingsCard title="Saved searches" hint={hint} aside={aside}>
      {pending && (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 motion-safe:animate-spin" />
          {pending === "delete" ? "Deleting search…" : "Saving search…"}
        </p>
      )}
      <fieldset disabled={pending !== null} className="min-w-0">
        {shown.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"><span className="sr-only">On</span></TableHead>
                <TableHead>Search</TableHead>
                <TableHead className="text-right" title="Postings the last fetch that worked brought">Found</TableHead>
                <TableHead title="The last fetch that brought any posting">Last with results</TableHead>
                <TableHead>Last read</TableHead>
                <TableHead className="w-8"><span className="sr-only">Delete</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((x) => (
                <SearchRow
                  key={x.id}
                  x={x}
                  onToggle={(enabled) => void change(x.id, enabled)}
                  onDelete={() => void change(x.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </fieldset>
      <AddSearchForm run={run} />
    </SettingsCard>
  );
}
