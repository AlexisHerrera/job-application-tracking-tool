import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { STAGES, dayToIso, label, type ApplicationInput } from "./api";
import { Field } from "./ApplicationView";

export const CHANNELS = ["", "direct", "linkedin", "referral", "recruiter", "other"];
export const SENIORITY = ["", "junior", "mid", "senior", "staff", "principal", "lead"];

export function ApplicationForm({
  initial,
  submitLabel,
  showStage = true,
  onSubmit,
}: {
  initial?: Partial<ApplicationInput>;
  submitLabel: string;
  showStage?: boolean;
  onSubmit: (data: ApplicationInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
    company: initial?.company ?? "",
    role_title: initial?.role_title ?? "",
    job_url: initial?.job_url ?? "",
    company_domain: initial?.company_domain ?? "",
    source_channel: initial?.source_channel ?? "",
    seniority: initial?.seniority ?? "",
    stack: (initial?.stack ?? []).join(", "),
    location: initial?.location ?? "",
    salary_min: initial?.salary_min?.toString() ?? "",
    salary_max: initial?.salary_max?.toString() ?? "",
    salary_currency: initial?.salary_currency ?? "USD",
    benefits: initial?.benefits ?? "",
    applied_at: initial?.applied_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    stage: "",
    notes: initial?.notes ?? "",
    job_description: initial?.job_description ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof form) => ({
    id: `app-${key}`,
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        company: form.company.trim(),
        role_title: form.role_title.trim(),
        job_url: form.job_url || null,
        company_domain: form.company_domain || undefined,
        source_channel: form.source_channel || null,
        seniority: form.seniority || null,
        stack: form.stack.split(",").map((s) => s.trim()).filter(Boolean),
        location: form.location || null,
        salary_min: form.salary_min ? Number(form.salary_min) : null,
        // A single figure is stored as min = max.
        salary_max: form.salary_max ? Number(form.salary_max) : form.salary_min ? Number(form.salary_min) : null,
        salary_currency: form.salary_min || form.salary_max ? form.salary_currency.toUpperCase() || null : null,
        benefits: form.benefits || null,
        applied_at: form.applied_at ? dayToIso(form.applied_at) : null,
        stage: (form.stage || null) as ApplicationInput["stage"],
        notes: form.notes || null,
        job_description: form.job_description || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company *" id="app-company"><Input required {...field("company")} /></Field>
        <Field label="Role *" id="app-role_title"><Input required {...field("role_title")} /></Field>
        <Field label="Job posting URL" id="app-job_url"><Input type="url" placeholder="https://…" {...field("job_url")} /></Field>
        <Field label="Company email domain" id="app-company_domain" hint="Teaches the email matcher">
          <Input placeholder="northwind.com" {...field("company_domain")} />
        </Field>
        <Field label="Applied on" id="app-applied_at"><Input type="date" {...field("applied_at")} /></Field>
        {showStage && (
          <Field label="Current stage" id="app-stage" hint="For applications already in progress">
            <NativeSelect className="w-full" {...field("stage")}>
              <NativeSelectOption value="">applied</NativeSelectOption>
              {STAGES.filter((s) => s !== "applied").map((s) => <NativeSelectOption key={s} value={s}>{label(s)}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        )}
        <Field label="Channel" id="app-source_channel">
          <NativeSelect className="w-full" {...field("source_channel")}>{CHANNELS.map((c) => <NativeSelectOption key={c} value={c}>{c || "—"}</NativeSelectOption>)}</NativeSelect>
        </Field>
        <Field label="Seniority" id="app-seniority">
          <NativeSelect className="w-full" {...field("seniority")}>{SENIORITY.map((c) => <NativeSelectOption key={c} value={c}>{c || "—"}</NativeSelectOption>)}</NativeSelect>
        </Field>
        <Field label="Stack (comma separated)" id="app-stack"><Input placeholder="python, aws, react" {...field("stack")} /></Field>
        <Field label="Location" id="app-location"><Input placeholder="Remote (LATAM)" {...field("location")} /></Field>
      </div>
      <div className="grid grid-cols-[1fr_1fr_6rem] gap-4">
        <Field label="Yearly salary min" id="app-salary_min"><Input type="number" min={0} step={1000} placeholder="90000" {...field("salary_min")} /></Field>
        <Field label="Yearly salary max" id="app-salary_max"><Input type="number" min={0} step={1000} placeholder="110000" {...field("salary_max")} /></Field>
        <Field label="Currency" id="app-salary_currency"><Input maxLength={8} {...field("salary_currency")} /></Field>
      </div>
      <Field label="Other benefits" id="app-benefits"><Textarea rows={2} placeholder="Equity, bonus, PTO, health, remote stipend…" {...field("benefits")} /></Field>
      <Field label="Job description" id="app-job_description"><Textarea rows={4} placeholder="Paste it: the study report uses it later" {...field("job_description")} /></Field>
      <Field label="Notes" id="app-notes"><Textarea rows={2} {...field("notes")} /></Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
