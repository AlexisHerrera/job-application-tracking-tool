import { useState } from "react";
import { Ban, Inbox as InboxIcon, Mail, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, errorText, fmtDate, label, type Application, type TimelineEvent } from "../api";
import { ApplicationForm } from "../ApplicationForm";
import { ApplicationPicker } from "../ApplicationPicker";
import { Empty, Loading, PageHeader } from "../components/common";
import { useRefresh } from "../lib/refresh";
import { useAsync } from "../useAsync";

export default function Inbox() {
  const inbox = useAsync(api.inbox);
  const apps = useAsync(() => api.applications());
  const count = inbox.data?.length ?? 0;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Inbox"
        description={count ? `${count} job email${count === 1 ? "" : "s"} couldn't be matched. Assigning teaches the matcher: the sender gets linked to that company.` : undefined}
      />
      {!inbox.data || !apps.data ? (
        <Loading error={inbox.error ?? apps.error} loading />
      ) : count === 0 ? (
        <Empty icon={<InboxIcon className="size-8" />}>Inbox zero: every job email is matched.</Empty>
      ) : (
        <div className="space-y-3">
          {inbox.data.map((e) => <InboxItem key={e.id} e={e} apps={apps.data!} />)}
        </div>
      )}
    </div>
  );
}

function InboxItem({ e, apps }: { e: TimelineEvent; apps: Application[] }) {
  const { bump } = useRefresh();
  const hint = (e.company_hint ?? e.extracted_company ?? "").toLowerCase();
  const suggested = hint ? apps.filter((a) => a.company.toLowerCase() === hint).map((a) => a.id) : [];
  const [target, setTarget] = useState(suggested.length === 1 ? suggested[0] : "");
  const [creating, setCreating] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      bump();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

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
          <Button size="sm" disabled={!target} onClick={() => run(() => api.assign(e.id, target), "Assigned. The sender is remembered.")}>Assign</Button>
          <Button size="sm" variant="outline" onClick={() => setCreating(!creating)}><Plus /> New application</Button>
          <Button size="sm" variant="ghost" onClick={() => run(() => api.dismiss(e.id), "Dismissed")}><Ban /> Not a job email</Button>
        </div>
        {creating && (
          <div className="rounded-lg border p-4">
            <ApplicationForm
              initial={{ company: e.extracted_company ?? e.company_hint ?? "", role_title: e.extracted_role ?? "", applied_at: e.occurred_at }}
              submitLabel="Create and assign"
              showStage={false}
              pasteFill={{ onUseExisting: (id) => { setTarget(id); setCreating(false); } }}
              onSubmit={async (data) => { await api.createFromEvent(e.id, data); toast.success("Created and assigned"); bump(); }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
