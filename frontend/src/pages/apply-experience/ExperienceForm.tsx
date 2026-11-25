import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/Field";
import type { ExperienceInput } from "@/api/apply";
import { STORY_FIELDS } from "./experienceFields";

/** Add or edit one experience. `onSave` resolves to whether it worked (errors are toasted). */
export function ExperienceForm({ initial, idPrefix, submitLabel, onSave, onCancel }: {
  initial: ExperienceInput;
  idPrefix: string;
  submitLabel: string;
  onSave: (data: ExperienceInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof ExperienceInput, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const id = (key: string) => `${idPrefix}-${key}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave(form);
    setBusy(false);
    if (ok && !onCancel) setForm(initial);
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Project or role" id={id("title")}>
          <Input id={id("title")} required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Payments ledger rewrite" />
        </Field>
        <Field label="Company" id={id("company")}>
          <Input id={id("company")} value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="Personal project" />
        </Field>
        <Field label="When" id={id("period")}>
          <Input id={id("period")} value={form.period} onChange={(e) => set("period", e.target.value)} placeholder="2023–2025" />
        </Field>
      </div>
      {STORY_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} id={id(f.key)} hint={f.hint}>
          <Textarea id={id(f.key)} rows={f.rows} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} />
        </Field>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stack" id={id("stack")}>
          <Input id={id("stack")} value={form.stack} onChange={(e) => set("stack", e.target.value)} placeholder="Python, FastAPI, Postgres, AWS Lambda" />
        </Field>
        <Field label="Links" id={id("links")} hint="Repo, demo, write-up">
          <Input id={id("links")} value={form.links} onChange={(e) => set("links", e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !form.title.trim()}>{submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
