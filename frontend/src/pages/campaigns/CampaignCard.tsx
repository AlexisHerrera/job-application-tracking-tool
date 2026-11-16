import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, fmtDate, type CampaignSummary } from "@/api";
import { Field } from "@/components/Field";
import { today } from "./today";

export function CampaignCard({ c, run }: { c: CampaignSummary; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
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
