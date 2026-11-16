import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { type ApplicationDetail, type ProcessNode } from "@/api/applications";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { useRefresh } from "@/lib/refresh";
import { InterviewBox } from "./InterviewBox";
import { StepActions } from "./StepActions";
import { KIND_LABEL, stateText } from "./timeline";
import { UseForStep } from "./UseForStep";

export function NodeDetails({ n, app, close, onPlan }: { n: ProcessNode; app: ApplicationDetail; close: () => void; onPlan: () => void }) {
  const { bump } = useRefresh();
  const openEditor = useOpenEditor();
  const iv = n.interview_id ? app.interviews.find((i) => i.id === n.interview_id) : undefined;
  const step = n.step_id ? app.steps.find((s) => s.id === n.step_id) : undefined;
  const done = () => { bump(); close(); };

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex items-center gap-1.5 font-medium">
          {n.label}
          {n.step_kind && n.step_kind !== "interview" && <span className="rounded bg-muted px-1.5 text-[11px] leading-5 font-normal text-muted-foreground">{KIND_LABEL[n.step_kind].toLowerCase()}</span>}
          {n.optional && <span className="rounded bg-muted px-1.5 text-[11px] leading-5 font-normal text-muted-foreground">maybe</span>}
          {n.kind === "interview" && <span className="rounded bg-muted px-1.5 text-[11px] leading-5 font-normal text-muted-foreground">not in the plan</span>}
        </div>
        <div className="text-xs text-muted-foreground">{n.kind === "outcome" && n.outcome === "ghosted" ? `No news for a while${app.last_event_at ? `, last on ${fmtDate(app.last_event_at)}` : ""}` : stateText(n)}</div>
      </div>

      {iv && <InterviewBox iv={iv} label={n.label} onOpen={() => { close(); openEditor("interview", iv.id); }} />}
      {step && <StepActions step={step} n={n} app={app} done={done} />}
      {n.kind === "interview" && iv && <UseForStep iv={iv} app={app} done={done} />}
      {n.kind === "outcome" && <p className="text-xs text-muted-foreground">Change it from the stage badge.</p>}
      {n.kind === "applied" && app.steps.length === 0 && (
        <p className="text-xs text-muted-foreground">Know how the process goes? Plan its steps and the calendar interviews will fall into place.</p>
      )}

      {(step || n.kind === "applied") && (
        <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" onClick={onPlan}><ListPlus /> {app.steps.length ? "Edit steps" : "Plan steps"}</Button>
      )}
    </div>
  );
}
