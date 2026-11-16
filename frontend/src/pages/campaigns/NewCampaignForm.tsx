import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/api";
import { Field } from "@/components/Field";
import { today } from "./today";

export function NewCampaignForm({ run }: { run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [form, setForm] = useState({ name: "", started_on: today(), notes: "" });

  async function create(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.createCampaign({ name: form.name, started_on: form.started_on, notes: form.notes || null }))) {
      setForm({ name: "", started_on: today(), notes: "" });
    }
  }

  return (
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
  );
}
