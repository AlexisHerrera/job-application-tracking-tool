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
  const failing = searches.filter((x) => x.enabled && x.last_status !== null && x.last_status !== "ok").length;
  const aside = (
    <>
      {failing > 0 && <span className="text-destructive tabular-nums">{failing} failing</span>}
      <span className="tabular-nums">{on} of {searches.length} on</span>
    </>
  );

  return (
    <SettingsCard title="Saved searches" hint={hint} aside={aside}>
      {searches.length > 0 && (
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
            {searches.map((x) => (
              <SearchRow
                key={x.id}
                x={x}
                onToggle={(enabled) => void run(() => api.updateSearch(x.id, { enabled }))}
                onDelete={() => void run(() => api.deleteSearch(x.id))}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <AddSearchForm run={run} />
    </SettingsCard>
  );
}
