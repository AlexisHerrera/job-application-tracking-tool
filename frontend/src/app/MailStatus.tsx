import { api } from "@/api/client";
import { timeAgo } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { ScanButton } from "./ScanButton";
import { StatusLine } from "./StatusLine";

/** When the inbox was last scanned, with the button that scans it (and the calendar) now.
 * Nothing when the scan isn't set up. */
export function MailStatus() {
  const status = useAsync(api.scanStatus).data;
  if (!status?.available) return null;
  return (
    <div className="flex h-7 items-center gap-1 px-1 text-xs">
      <StatusLine label="Mail & calendar" when={timeAgo(status.last_scan_at)}>
        <ScanButton />
      </StatusLine>
    </div>
  );
}
