import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { type DiscoveryProgress } from "@/api/discovery";
import { useDiscoveryStatus } from "./discoveryStatus";

export type Job = { kind: "run"; score: boolean; collect: boolean } | { kind: "rescore"; includeHidden: boolean };

/** Asks the server every second while `active` (or while it reports a run going). */
function useDiscoveryProgress(active: boolean) {
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let running = false;
      try {
        const r = await api.discoveryProgress();
        if (stopped) return;
        setProgress(r);
        running = r.running;
      } catch {
        // keep the last answer; try again
      }
      if (!stopped && (active || running)) timer = setTimeout(tick, 1000);
    };
    // When a job just started, give the request a moment to reach the server first.
    timer = setTimeout(tick, active ? 400 : 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);
  return [progress, setProgress] as const;
}

/** Locally, runs and re-scores wait for one long request; meanwhile the progress endpoint says where it is.
 * In AWS the request only starts the run (`started`), and the progress endpoint alone says when it ends. */
export function useDiscoveryJob(reload: () => void) {
  const status = useDiscoveryStatus();
  // The sidebar's Review count and last run move with every run.
  const reloadAll = () => {
    reload();
    status.refresh();
  };
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useDiscoveryProgress(job !== null);
  const working = job !== null || progress?.running === true;
  const wasRunning = useRef(false);
  useEffect(() => {
    // A run this page isn't waiting on (started in AWS, by the schedule, or before a reload): refresh when it ends.
    if (wasRunning.current && progress && !progress.running && job === null) {
      toast.success(progress.kind === "rescore" ? `${progress.scored} postings scored` : `Run finished: ${progress.new} new · ${progress.hidden} hidden · ${progress.scored} scored`);
      reloadAll();
    }
    wasRunning.current = progress?.running === true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.running]);

  async function start(next: Job) {
    if (working) return;
    setProgress(null);
    setJob(next);
    try {
      const r = next.kind === "run" ? await api.runDiscovery(next.score, next.collect) : await api.rescorePostings(next.includeHidden);
      if ("started" in r) {
        toast.info("Started. It runs in AWS: you can leave this page, the results stay.");
      } else {
        const msg = next.kind === "rescore" ? `${r.llm_calls} postings scored` : `${r.new} new · ${r.dropped} hidden · ${next.score ? `${r.llm_calls} scored` : "not scored"}`;
        if (r.errors) toast.warning(`${msg}. ${r.notes.join(" · ")}`);
        else toast.success(msg);
        reloadAll();
      }
    } catch (e) {
      toast.error(errorText(e));
    }
    setJob(null);
  }

  const panelKind = job ? (job.kind === "run" && !job.collect ? "score" : job.kind) : (progress?.kind ?? "run");
  const collectOnly = job?.kind === "run" && !job.score;
  return { working, progress, start, panelKind, collectOnly };
}
