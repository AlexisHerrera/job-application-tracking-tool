import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { useRefresh } from "@/lib/refresh";
import { calendarSummary, scanSummary } from "./scanSummary";

// Runs the incremental ingest now (reads Gmail, paid LLM calls for job-like mail), then the
// calendar sync if it's connected (read-only, free). Locally it runs in the API; in AWS the API
// invokes the ingest Lambda (which the schedule also runs every 15 minutes).
export function ScanButton({ calendarConnected }: { calendarConnected: boolean }) {
  const { bump } = useRefresh();
  const [busy, setBusy] = useState(false);

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
    if (calendarConnected) {
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
  const label = busy ? "Scanning…" : calendarConnected ? "Scan inbox & calendar" : "Scan inbox now";
  return (
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" disabled={busy} onClick={scan} title={label} aria-label={label}>
      <RefreshCw className={cn(busy && "animate-spin")} />
    </Button>
  );
}
