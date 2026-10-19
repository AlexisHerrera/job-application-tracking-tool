import { useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, errorText, fmtDate, type CampaignSummary } from "../api";
import { Field } from "../ApplicationView";
import { useCampaign } from "../campaign";
import { PageHeader } from "../components/common";
import { useRefresh } from "../lib/refresh";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });

export default function Campaigns() {
  const { campaigns, reload } = useCampaign();
  const { bump } = useRefresh();
  const [form, setForm] = useState({ name: "", started_on: today(), notes: "" });

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await reload();
      bump();
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.createCampaign({ name: form.name, started_on: form.started_on, notes: form.notes || null }))) {
      setForm({ name: "", started_on: today(), notes: "" });
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Campaigns" description="A campaign is one job-search period. Applications join it by their applied date." />
      <div className="grid gap-4">
        {campaigns.map((c) => <CampaignCard key={c.id} c={c} run={run} />)}
        <Card>
          <CardHeader><CardTitle>Start a new campaign</CardTitle><CardDescription>An ongoing earlier campaign ends the day before.</CardDescription></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={create}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" id="c-name"><Input id="c-name" required placeholder="Spring 2027" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label="Starts on" id="c-start"><Input id="c-start" type="date" required value={form.started_on} onChange={(e) => setForm({ ...form, started_on: e.target.value })} /></Field>
              </div>
              <Field label="Notes" id="c-notes"><Input id="c-notes" placeholder="Goals, target roles…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              <Button type="submit">Start campaign</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CampaignCard({ c, run }: { c: CampaignSummary; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: c.name, started_on: c.started_on, ended_on: c.ended_on ?? "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {c.name}
          {c.ongoing
            ? <span className="rounded-full bg-emerald-500/10 px-2 text-xs leading-5 font-medium text-emerald-700 dark:text-emerald-300">ongoing</span>
            : <span className="rounded-full bg-muted px-2 text-xs leading-5 font-medium text-muted-foreground">ended</span>}
        </CardTitle>
        <CardDescription>
          {fmtDate(c.started_on)} → {c.ended_on ? fmtDate(c.ended_on) : "ongoing"}
          {c.first_interview_on && <> · first interview {fmtDate(c.first_interview_on)}</>}
          {c.first_response_on && <> · first response {fmtDate(c.first_response_on)}</>}
        </CardDescription>
        <CardAction><Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}><Pencil /> {editing ? "Close" : "Edit"}</Button></CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[[c.day, "days"], [c.applications, "applications"], [c.per_week, "per week"], [c.days_to_first_interview ?? "—", "days to 1st interview"]].map(([v, l]) => (
            <div key={l} className="rounded-lg bg-muted/50 p-3"><div className="text-2xl font-semibold">{v}</div><div className="text-xs text-muted-foreground">{l}</div></div>
          ))}
        </div>
        {c.notes && <p className="text-sm">{c.notes}</p>}
        {editing && (
          <form className="space-y-4 rounded-lg border p-4" onSubmit={(e) => { e.preventDefault(); void run(() => api.updateCampaign(c.id, { ...f, ended_on: f.ended_on || null })); }}>
            <Field label="Name" id={`n-${c.id}`}><Input id={`n-${c.id}`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts on" id={`s-${c.id}`}><Input id={`s-${c.id}`} type="date" value={f.started_on} onChange={(e) => setF({ ...f, started_on: e.target.value })} /></Field>
              <Field label="Ends on (empty = ongoing)" id={`e-${c.id}`}><Input id={`e-${c.id}`} type="date" value={f.ended_on} onChange={(e) => setF({ ...f, ended_on: e.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm">Save</Button>
              {c.ongoing && <Button type="button" size="sm" variant="outline" onClick={() => run(() => api.updateCampaign(c.id, { ended_on: today() }))}>End today</Button>}
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => run(() => api.deleteCampaign(c.id))}>Delete (applications stay)</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
