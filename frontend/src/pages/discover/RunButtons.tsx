import { Download, Play, Sparkles } from "lucide-react";
import type { DiscoveryState } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Collect only / Score pending / Run now. */
export function RunButtons({ state, working, onRun }: { state: DiscoveryState; working: boolean; onRun: (score: boolean, collect: boolean) => void }) {
  if (!state.can_run) return null;
  const enabled = state.searches.filter((x) => x.enabled);
  const nothing = enabled.length === 0 && state.companies.enabled === 0;
  const sources = `${enabled.length} search${enabled.length === 1 ? "" : "es"} and ${state.companies.enabled} company board${state.companies.enabled === 1 ? "" : "s"}`;
  return (
    <>
      <Button size="sm" variant="outline" disabled={working || nothing} onClick={() => onRun(false, true)} title={`Reads ${sources} and stores what's new. No AI calls: new postings stay unscored.`}>
        <Download /> Collect only
      </Button>
      {state.unscored > 0 && (
        <Button size="sm" variant="outline" disabled={working || !state.llm_configured} onClick={() => onRun(true, false)} title={`Scores the ${state.unscored} postings that are waiting with AI, best location first (paid, about $${(state.unscored * 0.0005).toFixed(2)}). Reads no source.`}>
          <Sparkles /> Score pending ({state.unscored})
        </Button>
      )}
      <Button size="sm" disabled={working || nothing} onClick={() => onRun(true, true)} title={`Reads ${sources}, then scores up to 1,000 waiting postings with AI (paid, about $0.0005 each)`}>
        <Play className={cn(working && "animate-pulse")} /> {working ? "Running…" : "Run now"}
      </Button>
    </>
  );
}
