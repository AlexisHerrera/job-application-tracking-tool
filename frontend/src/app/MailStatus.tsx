import { useShellStatus } from "@/features/shell/shellStatus";
import { timeAgo } from "@/lib/format";
import { ScanButton } from "./ScanButton";
import { StatusLine } from "./StatusLine";

/** When the inbox was last scanned, with the button that scans it (and the calendar) now.
 * Nothing when the scan isn't set up. */
export function MailStatus() {
  const { shell } = useShellStatus();
  const status = shell?.scan;
  if (!status?.available) return null;
  return (
    <div className="flex h-7 items-center gap-1 px-1 text-xs">
      <StatusLine label="Mail & calendar" when={timeAgo(status.last_scan_at)}>
        <ScanButton calendarConnected={!!shell?.calendar.connected} />
      </StatusLine>
    </div>
  );
}
