import { useState, type FormEvent } from "react";
import { STAGES, label, type ApplicationInput } from "./api";

const CHANNELS = ["", "direct", "linkedin", "referral", "recruiter", "other"];
const SENIORITY = ["", "junior", "mid", "senior", "staff", "principal", "lead"];

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
    applied_at: initial?.applied_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    stage: "",
    notes: initial?.notes ?? "",
    job_description: initial?.job_description ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof form) => ({
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
        // Noon local time keeps the date stable across timezones.
        applied_at: form.applied_at ? `${form.applied_at}T12:00:00-03:00` : null,
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
    <form className="form" onSubmit={submit}>
      <label>Company *<input required {...field("company")} /></label>
      <label>Role *<input required {...field("role_title")} /></label>
      <label>Job posting URL<input type="url" placeholder="https://…" {...field("job_url")} /></label>
      <label>
        Company email domain
        <input placeholder="northwind.com (teaches the email matcher)" {...field("company_domain")} />
      </label>
      <div className="two">
        <label>Applied on<input type="date" {...field("applied_at")} /></label>
        {showStage && (
          <label>
            Current stage (for old applications)
            <select {...field("stage")}>
              <option value="">applied</option>
              {STAGES.filter((s) => s !== "applied").map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="two">
        <label>
          Channel
          <select {...field("source_channel")}>{CHANNELS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}</select>
        </label>
        <label>
          Seniority
          <select {...field("seniority")}>{SENIORITY.map((c) => <option key={c} value={c}>{c || "—"}</option>)}</select>
        </label>
      </div>
      <label>Stack (comma separated)<input placeholder="python, aws, react" {...field("stack")} /></label>
      <label>Location<input placeholder="Remote (LATAM)" {...field("location")} /></label>
      <label>Job description<textarea rows={4} placeholder="Paste it: the study report uses it later" {...field("job_description")} /></label>
      <label>Notes<textarea rows={2} {...field("notes")} /></label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}
