import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type ApplicationDetail } from "@/api";
import { useRefresh } from "@/lib/refresh";
import { PlanStepRow } from "./PlanStepRow";
import { attempt, parseSteps } from "./timeline";

// ---- the plan: what the recruiter said the process looks like ----

export function PlanDialog({ app, open, onOpenChange }: { app: ApplicationDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { bump } = useRefresh();
  const [text, setText] = useState("");
  const names = parseSteps(text);

  async function add() {
    await attempt(api.addSteps(app.id, names.map((name) => ({ name }))), () => { setText(""); bump(); });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Process steps · {app.company}</DialogTitle>
          <DialogDescription>
            What the recruiter said to expect. Interview steps pick up the calendar interviews in order; take-homes you mark done yourself from the timeline.
          </DialogDescription>
        </DialogHeader>
        {app.steps.length > 0 && (
          <ol className="space-y-1.5" aria-label="Steps">
            {app.steps.map((st, i) => (
              <PlanStepRow key={`${st.id}-${st.name}`} step={st} index={i} count={app.steps.length} onDone={bump} />
            ))}
          </ol>
        )}
        <div className="space-y-2">
          <Label htmlFor="plan-add">{app.steps.length ? "Add more steps" : "Steps, one per line"}</Label>
          <Textarea
            id="plan-add"
            rows={app.steps.length ? 2 : 5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && names.length) { e.preventDefault(); void add(); } }}
            placeholder={"Recruiter call\nAgency director\nHR director\nChallenge\nChallenge defense + interview"}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">"Challenge", "take-home"… become take-homes. Change any kind below.</p>
            <Button size="sm" disabled={!names.length} onClick={add}><Plus /> Add{names.length ? ` ${names.length}` : ""}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
