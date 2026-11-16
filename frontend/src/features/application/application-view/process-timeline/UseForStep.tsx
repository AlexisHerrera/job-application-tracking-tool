import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "@/api/client";
import { type ApplicationDetail } from "@/api/applications";
import { type Interview } from "@/api/interviews";
import { attempt } from "./timeline";

/** An interview no step took: say which step it was. */
export function UseForStep({ iv, app, done }: { iv: Interview; app: ApplicationDetail; done: () => void }) {
  const steps = app.steps.filter((s) => s.kind === "interview");
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1">
      <Label htmlFor={`use-${iv.id}`} className="text-xs text-muted-foreground">It was the step…</Label>
      <NativeSelect
        id={`use-${iv.id}`}
        size="sm"
        className="w-full"
        value=""
        onChange={(e) => e.target.value && void attempt(api.updateStep(e.target.value, { interview_id: iv.id }), done)}
      >
        <NativeSelectOption value="">Extra: not in the plan</NativeSelectOption>
        {steps.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.position + 1}. {s.name}</NativeSelectOption>)}
      </NativeSelect>
    </div>
  );
}
