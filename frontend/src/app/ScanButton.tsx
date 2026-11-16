import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api, errorText, timeAgo } from "@/api";
import { useRefresh } from "@/lib/refresh";
import { useAsync } from "@/lib/useAsync";
import { calendarSummary, scanSummary } from "./scanSummary";

// Runs the incremental ingest now (reads Gmail, paid LLM calls for job-like mail), then the
// calendar sync if it's connected (read-only, free). Locally it runs in the API; in AWS the API
// invokes the ingest Lambda (which the schedule also runs every 15 minutes).
export function ScanButton() {
  const { bump } = useRefresh();
  const status = useAsync(api.scanStatus).data;
  const calendar = useAsync(api.calendarStatus).data;
  const [busy, setBusy] = useState(false);
  if (!status?.available) return null;

  async function scan() {
    setBusy(true);
    const id = toast.loading("Checking your inbox…");
    try {
      const r = await api.scan();
      if (r.running) toast.info("Still scanning in the background. New mail will show up when it's done.", { id });
      else if (r.errors) toast.warning(`${scanSummary(r)}. Stopped at an email that failed; the next scan retries it.`, { id });
      else toast.success(scanSummary(r), { id });
    } catch (e) {
      toast.error(errorText(e), { id });
    }
    if (calendar?.connected) {
      try {
        const c = calendarSummary(await api.syncCalendar());
        if (c) toast.success(c);
      } catch (e) {
        toast.error(`Calendar: ${errorText(e)}`);
      }
    }
    bump();
    setBusy(false);
  }
  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" className="w-full justify-start" disabled={busy} onClick={scan}>
        <RefreshCw className={cn(busy && "animate-spin")} /> {busy ? "Scanning…" : calendar?.connected ? "Scan inbox & calendar" : "Scan inbox now"}
      </Button>
      <p className="px-1 text-xs text-muted-foreground">Last scan: {timeAgo(status.last_scan_at)}</p>
    </div>
  );
}
