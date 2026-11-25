import { PendingButton } from "@/components/PendingButton";
import { usePending } from "@/lib/usePending";
import { useState } from "react";
import { Ban, Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { fmtDate, label } from "@/lib/format";
import { type Application, type TimelineEvent } from "@/api/applications";
import { ApplicationForm } from "@/features/application/application-form/ApplicationForm";
import { useRefresh } from "@/lib/refresh";
import { ApplicationPicker } from "./ApplicationPicker";

export function UnmatchedEmailItem({ e, apps }: { e: TimelineEvent; apps: Application[] }) {
  const { pending, run: runPending } = usePending<"assign" | "dismiss" | "create">();
  const { bump } = useRefresh();
  const hint = (e.company_hint ?? e.extracted_company ?? "").toLowerCase();
  const suggested = hint ? apps.filter((a) => a.company.toLowerCase() === hint).map((a) => a.id) : [];
  const [target, setTarget] = useState(suggested.length === 1 ? suggested[0] : "");
  const [creating, setCreating] = useState(false);
  const run = (key: NonNullable<typeof pending>, fn: () => Promise<unknown>, done: string) => runPending(key, async () => {
    try {
      await fn();
      toast.success(done);
      bump();
    } catch (err) {
      toast.error(errorText(err));
    }
  });

  return (
    <Card className="gap-3 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-3.5" />
            <span className="truncate">{e.from_name} &lt;{e.from_address}&gt;</span>
            <span className="ml-auto shrink-0">{fmtDate(e.occurred_at, true)}</span>
          </div>
          <div className="font-medium">{e.subject}</div>
          <div className="text-sm">
            <span className="font-medium">{label(e.event_type)}</span>
            {e.extracted_company && <> · looks like <em>{e.extracted_company}</em></>}
            {e.extracted_role && <> / {e.extracted_role}</>}
            {e.confidence != null && <span className="text-muted-foreground"> · {Math.round(e.confidence * 100)}% sure</span>}
          </div>
          {e.summary && <div className="text-sm text-muted-foreground">{e.summary}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationPicker apps={apps} value={target} onChange={setTarget} suggested={suggested} placeholder="Assign to… (type company, role, status)" />
          <PendingButton pending={pending === "assign"} size="sm" disabled={!target || pending !== null} onClick={() => run("assign", () => api.assign(e.id, target), "Assigned. The sender is remembered.")}>Assign</PendingButton>
          <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => setCreating(!creating)}><Plus /> New application</Button>
          <PendingButton pending={pending === "dismiss"} disabled={pending !== null} size="sm" variant="ghost" onClick={() => run("dismiss", () => api.dismiss(e.id), "Dismissed")}>{pending !== "dismiss" && <Ban />} Not a job email</PendingButton>
        </div>
        {creating && (
          <div className="rounded-lg border p-4">
            <ApplicationForm
              initial={{ company: e.extracted_company ?? e.company_hint ?? "", role_title: e.extracted_role ?? "", applied_at: e.occurred_at }}
              submitLabel="Create and assign"
              showStage={false}
              pasteFill={{ onUseExisting: (id) => { setTarget(id); setCreating(false); } }}
              onSubmit={async (data) => { await runPending("create", async () => { await api.createFromEvent(e.id, data); toast.success("Created and assigned"); bump(); }); }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
