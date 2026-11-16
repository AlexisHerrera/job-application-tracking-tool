import { History } from "lucide-react";
import { api } from "@/api/client";
import { Empty, Loading } from "@/components/common";
import { useAsync } from "@/lib/useAsync";
import { RunRow } from "./RunRow";

/** The last 30 runs, newest first, with their notes and errors. */
export function RunsTab() {
  const runs = useAsync(() => api.discoveryRuns(30));
  if (!runs.data) return <Loading error={runs.error} loading={runs.loading} />;
  if (runs.data.length === 0) return <Empty icon={<History className="size-8" />}>No runs yet.</Empty>;
  return (
    <section className="rounded-lg border bg-card">
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">The last {runs.data.length} runs, from the page, the terminal or the schedule. “Hidden” counts what the rules hid as it was stored.</p>
      <ul className="divide-y">
        {runs.data.map((r) => <RunRow key={r.id} run={r} />)}
      </ul>
    </section>
  );
}
