import { Link } from "react-router-dom";
import { useDiscoveryStatus } from "@/features/discovery/discoveryStatus";
import { timeAgo } from "@/lib/format";
import { runErrors } from "./runErrors";
import { StatusLine } from "./StatusLine";

/** When discovery last ran (re-scores read no source, so they don't count), in red if that run
 * had errors. Opens the Sources page. */
export function JobSourcesStatus({ onNavigate }: { onNavigate?: () => void }) {
  const { status } = useDiscoveryStatus();
  if (!status) return null;
  const run = status.last_run;
  const errors = runErrors(run);
  return (
    <Link
      to="/discover/sources"
      onClick={onNavigate}
      title={errors ? `${errors}: ${run?.notes.join(" · ")}` : "Sources and past runs"}
      className="flex h-7 items-center gap-1 rounded-md px-1 text-xs transition-colors hover:bg-sidebar-accent"
    >
      <StatusLine label="Job sources" when={run ? timeAgo(run.finished_at ?? run.started_at) : "never"} error={!!errors} />
    </Link>
  );
}
