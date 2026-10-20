import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { STAGES, dayToIso, isoToDay, label, type ApplicationInput } from "./api";
import { Field } from "./ApplicationView";
import { PasteFill, type FillReport, type FillResult } from "./PasteFill";
import { SalaryInputs, draftFrom, readSalary, type SalaryDraft } from "./SalaryInput";

export const CHANNELS = ["", "direct", "linkedin", "referral", "recruiter", "other"];
export const SENIORITY = ["", "junior", "mid", "senior", "staff", "principal", "lead"];

export function ApplicationForm({
  initial,
  submitLabel,
  showStage = true,
  pasteFill,
  onSubmit,
}: {
  initial?: Partial<ApplicationInput>;
  submitLabel: string;
  showStage?: boolean;
  /** Show the "fill from a recruiter chat" box; onUseExisting offers an existing match instead. */
  pasteFill?: { onUseExisting?: (applicationId: string) => void };
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
    benefits: initial?.benefits ?? "",
    applied_at: initial?.applied_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    stage: "",
    notes: initial?.notes ?? "",
    job_description: initial?.job_description ?? "",
  });
  const [salary, setSalary] = useState(() => draftFrom(initial));
  const [sourceAts, setSourceAts] = useState(initial?.source_ats ?? ""); // no field for it; kept from the AI fill
  const [fromChat, setFromChat] = useState<Set<string>>(new Set());
  const [beforeFill, setBeforeFill] = useState<{ form: typeof form; salary: SalaryDraft; sourceAts: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tag = (key: string) => (fromChat.has(key) ? "from chat" : undefined);

  function fill({ company, values }: FillResult): FillReport {
    const next = { ...form };
    const report: FillReport = { filled: [], replaced: [] };
    const keys = new Set<string>();
    const put = (key: keyof typeof form, value: unknown, text: string) => {
      const v = Array.isArray(value) ? value.join(", ") : key === "applied_at" ? isoToDay(value as string) : String(value ?? "").trim();
      if (!v || v === next[key]) return;
      if (key === "notes" && next.notes) {
        if (next.notes.includes(v)) return;
        next.notes = `${next.notes}\n${v}`;
        report.filled.push(text);
      } else {
        if (next[key]) report.replaced.push({ label: text, from: next[key], to: v });
        else report.filled.push(text);
        next[key] = v;
      }
      keys.add(key);
    };
    if (company) put("company", company, "Company");
    else report.noCompany = { kept: next.company.trim() || null };
    put("role_title", values.role_title, "Role");
    put("job_url", values.job_url, "Posting URL");
    put("company_domain", values.company_domain, "Email domain");
    put("source_channel", values.source_channel, "Channel");
    put("seniority", values.seniority, "Seniority");
    put("stack", values.stack, "Stack");
    put("location", values.location, "Location");
    put("applied_at", values.applied_at, "Applied on");
    put("benefits", values.benefits, "Benefits");
    put("job_description", values.job_description, "Job description");
    put("notes", values.notes, "Notes");
    setBeforeFill({ form, salary, sourceAts });
    if (values.salary_min != null || values.salary_max != null) {
      setSalary(draftFrom({
        salary_min: (values.salary_min as number | undefined) ?? null,
        salary_max: (values.salary_max as number | undefined) ?? null,
        salary_currency: (values.salary_currency as string | undefined) ?? salary.currency,
      }));
      keys.add("salary");
      report.filled.push("Salary");
    } else if (values.salary_currency && values.salary_currency !== salary.currency) {
      // Currency known, amount not ("sueldo en dólares"): preset it for when a figure is typed.
      setSalary({ ...salary, currency: String(values.salary_currency) });
      keys.add("salary");
      report.filled.push("Currency");
    }
    if (values.source_ats) setSourceAts(String(values.source_ats));
    setForm(next);
    setFromChat(keys);
    return report;
  }

  function undoFill() {
    if (!beforeFill) return;
    setForm(beforeFill.form);
    setSalary(beforeFill.salary);
    setSourceAts(beforeFill.sourceAts);
    setFromChat(new Set());
    setBeforeFill(null);
  }
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof form) => ({
    id: `app-${key}`,
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pay = readSalary(salary);
    if (!pay.patch) return setError(`Salary: ${pay.error}`);
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        company: form.company.trim(),
        role_title: form.role_title.trim(),
        job_url: form.job_url || null,
        company_domain: form.company_domain || undefined,
        source_channel: form.source_channel || null,
        source_ats: sourceAts || null,
        seniority: form.seniority || null,
        stack: form.stack.split(",").map((s) => s.trim()).filter(Boolean),
        location: form.location || null,
        ...pay.patch,
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
      {pasteFill && <PasteFill onFill={fill} onUndo={undoFill} onUseExisting={pasteFill.onUseExisting} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company *" id="app-company" tag={tag("company")}><Input required {...field("company")} /></Field>
        <Field label="Role *" id="app-role_title" tag={tag("role_title")}><Input required {...field("role_title")} /></Field>
        <Field label="Job posting URL" id="app-job_url" tag={tag("job_url")}><Input type="url" placeholder="https://…" {...field("job_url")} /></Field>
        <Field label="Company email domain" id="app-company_domain" hint="Teaches the email matcher" tag={tag("company_domain")}>
          <Input placeholder="northwind.com" {...field("company_domain")} />
        </Field>
        <Field label="Applied on" id="app-applied_at" tag={tag("applied_at")}><Input type="date" {...field("applied_at")} /></Field>
        {showStage && (
          <Field label="Current stage" id="app-stage" hint="For applications already in progress">
            <NativeSelect className="w-full" {...field("stage")}>
              <NativeSelectOption value="">applied</NativeSelectOption>
              {STAGES.filter((s) => s !== "applied").map((s) => <NativeSelectOption key={s} value={s}>{label(s)}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        )}
        <Field label="Channel" id="app-source_channel" tag={tag("source_channel")}>
          <NativeSelect className="w-full" {...field("source_channel")}>{CHANNELS.map((c) => <NativeSelectOption key={c} value={c}>{c || "—"}</NativeSelectOption>)}</NativeSelect>
        </Field>
        <Field label="Seniority" id="app-seniority" tag={tag("seniority")}>
          <NativeSelect className="w-full" {...field("seniority")}>{SENIORITY.map((c) => <NativeSelectOption key={c} value={c}>{c || "—"}</NativeSelectOption>)}</NativeSelect>
        </Field>
        <Field label="Stack (comma separated)" id="app-stack" tag={tag("stack")}><Input placeholder="python, aws, react" {...field("stack")} /></Field>
        <Field label="Location" id="app-location" tag={tag("location")}><Input placeholder="Remote (LATAM)" {...field("location")} /></Field>
      </div>
      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="flex items-center gap-2 px-1 text-sm font-medium">
          Salary
          {tag("salary") && <span className="rounded bg-indigo-500/10 px-1.5 text-xs leading-5 font-normal text-indigo-700 dark:text-indigo-300">from chat</span>}
        </legend>
        <SalaryInputs value={salary} onChange={setSalary} />
      </fieldset>
      <Field label="Other benefits" id="app-benefits" tag={tag("benefits")}><Textarea rows={2} placeholder="Equity, bonus, PTO, health, remote stipend…" {...field("benefits")} /></Field>
      <Field label="Job description" id="app-job_description" tag={tag("job_description")}><Textarea rows={4} placeholder="Paste it: the study report uses it later" {...field("job_description")} /></Field>
      <Field label="Notes" id="app-notes" tag={tag("notes")}><Textarea rows={2} {...field("notes")} /></Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
    </form>
  );
}
