import { useState } from "react";
import { Ban, CalendarDays, Inbox as InboxIcon, Mail, MessagesSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, errorText, fmtDate, label, type Application, type Interview, type TimelineEvent } from "../api";
import { ApplicationForm } from "../ApplicationForm";
import { ApplicationPicker } from "../ApplicationPicker";
import { Empty, Loading, PageHeader } from "../components/common";
import { useRefresh } from "../lib/refresh";
import { useAsync } from "@/lib/useAsync";

export default function Inbox() {
  const inbox = useAsync(api.inbox);
  const apps = useAsync(() => api.applications());
  const calendar = useAsync(api.unassignedInterviews);
  const count = inbox.data?.length ?? 0;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Inbox"
        description={count ? `${count} job email${count === 1 ? "" : "s"} couldn't be matched. Assigning teaches the matcher: the sender gets linked to that company.` : undefined}
      />
      {apps.data && calendar.data && calendar.data.length > 0 && (
        <section className="mb-6 space-y-3" aria-labelledby="calendar-heading">
          <h2 id="calendar-heading" className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="size-4 text-muted-foreground" /> Calendar interviews to match · {calendar.data.length}
          </h2>
          {calendar.data.map((iv) => <CalendarItem key={iv.id} iv={iv} apps={apps.data!} />)}
        </section>
      )}
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

function CalendarItem({ iv, apps }: { iv: Interview; apps: Application[] }) {
  const { bump } = useRefresh();
  const hint = (iv.company ?? "").toLowerCase();
  const suggested = hint ? apps.filter((a) => a.company.toLowerCase() === hint).map((a) => a.id) : [];
  const [target, setTarget] = useState(suggested.length === 1 ? suggested[0] : "");
  const others = iv.attendees.filter((a) => a !== iv.organizer).slice(0, 3);
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
            <CalendarDays className="size-3.5" />
            <span className="truncate">{[iv.organizer, ...others].filter(Boolean).join(", ") || "No other attendees"}</span>
            <span className="ml-auto shrink-0">{fmtDate(iv.starts_at, true)}</span>
          </div>
          <div className="font-medium">{iv.title || "(no title)"}</div>
          {iv.company && <div className="text-sm text-muted-foreground">Someone from <em>{iv.company}</em> is on it, but it has several applications.</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationPicker apps={apps} value={target} onChange={setTarget} suggested={suggested} placeholder="Assign to… (type company, role, status)" />
          <Button size="sm" disabled={!target} onClick={() => run(() => api.assignInterview(iv.id, target), "Assigned. The attendees' company domain is remembered.")}>Assign</Button>
          <Button size="sm" variant="outline" onClick={() => run(() => api.markGeneral(iv.id), "Kept as a general talk. Add notes on the Interviews page.")}>
            <MessagesSquare /> General talk, no application
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run(() => api.removeInterview(iv.id), "Hidden")}><Ban /> Not an interview</Button>
        </div>
      </CardContent>
    </Card>
  );
}
