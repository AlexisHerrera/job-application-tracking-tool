import { useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, dayToIso, fmtDate, isoToDay, type ApplicationDetail, type ProcessNode, type ProcessStep } from "@/api";
import { interviewName } from "@/lib/interviews";
import { attempt, shortDay } from "./timeline";

export function StepActions({ step, n, app, done }: { step: ProcessStep; n: ProcessNode; app: ApplicationDetail; done: () => void }) {
  const [day, setDay] = useState(() => isoToDay(new Date().toISOString()));
  const ivs = [...app.interviews].filter((i) => i.status === "scheduled").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const linkValue = step.link === "auto" ? "auto" : step.interview_id ?? "none";
  const setLink = (v: string) =>
    attempt(api.updateStep(step.id, v === "auto" ? { link: "auto" } : { interview_id: v === "none" ? null : v }), done);

  return (
    <div className="space-y-2.5">
      {step.kind === "interview" && (
        <div className="space-y-1">
          <Label htmlFor={`link-${step.id}`} className="text-xs text-muted-foreground">Interview</Label>
          <NativeSelect id={`link-${step.id}`} size="sm" className="w-full" value={linkValue} onChange={(e) => void setLink(e.target.value)}>
            <NativeSelectOption value="auto">Automatic: next one in time</NativeSelectOption>
            <NativeSelectOption value="none">Hasn't happened yet</NativeSelectOption>
            {ivs.map((i) => <NativeSelectOption key={i.id} value={i.id}>{shortDay(i.starts_at)} · {interviewName(i)}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      )}
      {step.done_at ? (
        <div className="flex items-center gap-2 text-xs">
          <Check className="size-3.5 text-[var(--flow-interviewing)]" /> Marked done on {fmtDate(step.done_at)}
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void attempt(api.updateStep(step.id, { done_at: null }), done)}><Undo2 /> Undo</Button>
        </div>
      ) : !n.interview_id && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => { e.preventDefault(); void attempt(api.updateStep(step.id, { done_at: dayToIso(day) }), done); }}
        >
          <Input type="date" aria-label="Done on" className="h-7 flex-1 text-xs" value={day} onChange={(e) => setDay(e.target.value)} required />
          <Button type="submit" size="xs"><Check /> Mark done</Button>
        </form>
      )}
    </div>
  );
}
