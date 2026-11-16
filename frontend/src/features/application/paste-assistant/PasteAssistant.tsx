import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/api/client";
import { type ApplicationInput, type PasteRecord } from "@/api/applications";
import { defaults, summarize, type Selection } from "./paste";
import { PasteRecordCard } from "./PasteRecordCard";
import { PasteSummary } from "./PasteSummary";

// Review-before-write flow: the AI only proposes. Fills are preselected; anything that would
// overwrite a value you already have starts unchecked and is called out before applying.

export function PasteAssistant({ applicationId, onApplied }: { applicationId?: string; onApplied?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<PasteRecord[] | null>(null);
  const [sel, setSel] = useState<Selection[]>([]);
  const [done, setDone] = useState<string | null>(null);

  async function read() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api.paste(text, applicationId);
      setRecords(r.records);
      setSel(r.records.map((rec) => {
        const opt = rec.options[rec.default_option];
        return { option: rec.default_option, skip: false, role: "", company: "", ...defaults(opt) };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const update = (i: number, patch: Partial<Selection>) => setSel(sel.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const summary = useMemo(() => (records ? summarize(records, sel) : null), [records, sel]);

  async function apply() {
    if (!records) return;
    setBusy(true);
    setError(null);
    try {
      for (const [i, rec] of records.entries()) {
        const s = sel[i];
        if (s.skip) continue;
        const opt = rec.options[s.option];
        const values = Object.fromEntries(opt.changes.filter((c) => s.fields.has(c.field)).map((c) => [c.field, c.proposed]));
        const stage = s.stage && opt.stage_change ? opt.stage_change : null;
        if (opt.application_id === null) {
          const role = (values.role_title as string) || s.role.trim();
          const company = rec.company ?? s.company.trim();
          if (!company) throw new Error(`${role || "A position"}: type the hiring company before creating it`);
          if (!role) throw new Error(`${company}: type a role before creating it`);
          await api.createApplication({
            ...(values as Partial<ApplicationInput>),
            company,
            role_title: role,
            stage: stage?.proposed ?? null,
            stage_at: stage?.at ?? null,
          });
        } else {
          if (Object.keys(values).length) await api.updateApplication(opt.application_id, values);
          if (stage) await api.changeStage(opt.application_id, { stage: stage.proposed, at: stage.at ?? undefined, note: "from pasted notes" });
        }
      }
      setDone("Saved.");
      setRecords(null);
      setText("");
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!records) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Paste anything: emails, Slack or LinkedIn messages, a job post, your own notes. The AI proposes{" "}
          {applicationId ? "updates to this application" : "new applications or updates to existing ones"}; you review every
          change before anything is saved. The pasted text itself is not stored.
        </p>
        <Textarea rows={applicationId ? 5 : 10} value={text} onChange={(e) => setText(e.target.value)} aria-label="Text to read"
          placeholder={"e.g. \"Applied to Northwind (Senior Backend) on Sep 3 via referral. Recruiter said 90–110k USD + equity. Rejected after the system design round on Oct 2.\""} />
        <Button onClick={read} disabled={busy || !text.trim()}><Sparkles /> {busy ? "Reading…" : "Read with AI"}</Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {done && <p className="text-sm text-emerald-700 dark:text-emerald-400">{done}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {records.length === 0 && <p className="text-sm text-muted-foreground">No position found in that text: it names neither a company nor a role.</p>}
      {records.map((rec, i) => (
        <PasteRecordCard key={i} rec={rec} index={i} selection={sel[i]} onChange={(patch) => update(i, patch)} />
      ))}
      {summary && <PasteSummary summary={summary} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={apply} disabled={busy}>{busy ? "Saving…" : summary?.overwrites.length ? "Apply, including overwrites" : "Apply"}</Button>
        <Button variant="ghost" onClick={() => setRecords(null)}>Back to text</Button>
      </div>
    </div>
  );
}
