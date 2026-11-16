import { CalendarRange, GanttChart } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/api/client";
import { useCampaign } from "@/lib/campaign";
import { Loading, PageHeader } from "@/components/common";
import { useSearchParamsPatch } from "@/lib/useSearchParamsPatch";
import { useAsync } from "@/lib/useAsync";
import { MonthView } from "./month/MonthView";
import { ProcessesView } from "./processes/ProcessesView";

export default function CalendarPage() {
  const [params, set] = useSearchParamsPatch();
  const view = params.get("view") === "processes" ? "processes" : "month";
  const { selected: campaign } = useCampaign();
  const { data, error, loading } = useAsync(() => api.activity(campaign), [campaign]);

  return (
    <>
      <PageHeader
        title="Calendar"
        description="What happened when, and how long each process has taken"
        actions={
          <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && set({ view: v === "month" ? null : v })} aria-label="View">
            <ToggleGroupItem value="month"><CalendarRange /> Month</ToggleGroupItem>
            <ToggleGroupItem value="processes"><GanttChart /> Processes</ToggleGroupItem>
          </ToggleGroup>
        }
      />
      {!data ? (
        <Loading error={error} loading={loading} rows={6} />
      ) : view === "month" ? (
        <MonthView items={data.items} month={params.get("month")} day={params.get("day")} set={set} />
      ) : (
        <ProcessesView processes={data.processes} hideClosed={params.get("closed") === "hide"} set={set} />
      )}
    </>
  );
}
