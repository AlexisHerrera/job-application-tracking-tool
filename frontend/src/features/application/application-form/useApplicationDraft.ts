import { useState } from "react";
import { isoToDay } from "@/lib/format";
import { type ApplicationInput, type StepInput } from "@/api/applications";
import { draftFrom, type SalaryDraft } from "@/features/application/salary";
import type { FillReport, FillResult } from "./fill";

/** The form's values, plus filling them from a pasted chat (and undoing that fill). */
export function useApplicationDraft(initial?: Partial<ApplicationInput>) {
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
  const [steps, setSteps] = useState<StepInput[]>([]); // the process the AI read; becomes the plan
  const [fromChat, setFromChat] = useState<Set<string>>(new Set());
  const [beforeFill, setBeforeFill] = useState<{ form: typeof form; salary: SalaryDraft; sourceAts: string; steps: StepInput[] } | null>(null);

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
    setBeforeFill({ form, salary, sourceAts, steps });
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
    const process = (values.process_steps as StepInput[] | undefined) ?? [];
    if (process.length) {
      setSteps(process);
      report.filled.push(`Process (${process.length} steps)`);
    }
    setForm(next);
    setFromChat(keys);
    return report;
  }

  function undoFill() {
    if (!beforeFill) return;
    setForm(beforeFill.form);
    setSalary(beforeFill.salary);
    setSourceAts(beforeFill.sourceAts);
    setSteps(beforeFill.steps);
    setFromChat(new Set());
    setBeforeFill(null);
  }

  return { form, setForm, salary, setSalary, sourceAts, steps, setSteps, fromChat, fill, undoFill };
}
