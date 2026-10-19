import { useMemo, useState } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, fmtDate, label, type ApplicationInput, type FieldChange, type PasteOption, type PasteRecord } from "./api";

// Review-before-write flow: the AI only proposes. Fills are preselected; anything that would
// overwrite a value you already have starts unchecked and is called out before applying.

type Selection = { option: number; fields: Set<string>; stage: boolean; skip: boolean; role: string };

const KIND_TEXT: Record<FieldChange["kind"], string> = {
  fill: "fills empty",
  append: "adds to",
  change: "⚠ will modify",
};

const KIND_CLASS: Record<FieldChange["kind"], string> = {
  fill: "text-emerald-700 dark:text-emerald-400",
  append: "text-blue-700 dark:text-blue-400",
  change: "text-amber-700 dark:text-amber-400",
};

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (field === "applied_at" && typeof value === "string") return fmtDate(value);
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value);
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function defaults(option: PasteOption): Pick<Selection, "fields" | "stage"> {
  return {
    fields: new Set(option.changes.filter((c) => c.kind !== "change").map((c) => c.field)),
    stage: option.stage_change?.kind === "fill",
  };
}

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
        return { option: rec.default_option, skip: false, role: "", ...defaults(opt) };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const update = (i: number, patch: Partial<Selection>) => setSel(sel.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const summary = useMemo(() => {
    if (!records) return null;
    let creates = 0, updates = 0, fills = 0, appends = 0;
    const overwrites: string[] = [];
    records.forEach((rec, i) => {
      const s = sel[i];
      if (!s || s.skip) return;
      const opt = rec.options[s.option];
      const picked = opt.changes.filter((c) => s.fields.has(c.field));
      if (opt.application_id === null) creates++;
      else if (picked.length || (s.stage && opt.stage_change)) updates++;
      for (const c of picked) {
        if (c.kind === "fill") fills++;
        else if (c.kind === "append") appends++;
        else overwrites.push(`${rec.company}: ${c.label} "${show(c.field, c.current)}" → "${show(c.field, c.proposed)}"`);
      }
      if (s.stage && opt.stage_change?.kind === "change") {
        overwrites.push(`${rec.company}: stage ${opt.stage_change.current} → ${opt.stage_change.proposed}`);
      }
    });
    return { creates, updates, fills, appends, overwrites };
  }, [records, sel]);

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
          if (!role) throw new Error(`${rec.company}: type a role before creating it`);
          await api.createApplication({
            ...(values as Partial<ApplicationInput>),
            company: rec.company,
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
      {records.length === 0 && <p className="text-sm text-muted-foreground">The AI didn't find any application details in that text.</p>}
      {records.map((rec, i) => {
        const s = sel[i];
        const opt = rec.options[s.option];
        const isNew = opt.application_id === null;
        const hasRole = opt.changes.some((c) => c.field === "role_title" && s.fields.has(c.field));
        const toggle = (field: string, on: boolean) => {
          const fields = new Set(s.fields);
          if (on) fields.add(field);
          else fields.delete(field);
          update(i, { fields });
        };
        return (
          <div key={i} className={cn("space-y-3 rounded-lg border p-4", s.skip && "opacity-50")}>
            <div className="flex flex-wrap items-center gap-3">
              <strong>{rec.company}</strong>
              {rec.options.length > 1 ? (
                <NativeSelect size="sm" value={s.option} aria-label="Apply to" onChange={(e) => {
                  const option = Number(e.target.value);
                  update(i, { option, ...defaults(rec.options[option]) });
                }}>
                  {rec.options.map((o, j) => <NativeSelectOption key={j} value={j}>{o.label}</NativeSelectOption>)}
                </NativeSelect>
              ) : <span className="text-sm text-muted-foreground">{opt.label}</span>}
              <Label className="ml-auto text-sm font-normal">
                <Checkbox checked={s.skip} onCheckedChange={(v) => update(i, { skip: v === true })} /> skip
              </Label>
            </div>
            {rec.evidence && <div className="text-sm text-muted-foreground italic">“{rec.evidence}”</div>}
            {rec.salary_note && <div className="text-sm text-muted-foreground">Salary {rec.salary_note}.</div>}
            {!s.skip && (
              <>
                {opt.changes.length === 0 && !opt.stage_change && <p className="text-sm text-muted-foreground">Nothing new for this application.</p>}
                {isNew && !hasRole && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`paste-role-${i}`}>Role (required)</Label>
                    <Input id={`paste-role-${i}`} value={s.role} onChange={(e) => update(i, { role: e.target.value })} />
                  </div>
                )}
                <div className="divide-y rounded-md border">
                  {opt.changes.map((c) => (
                    <label key={c.field} className={cn("grid cursor-pointer grid-cols-[auto_8rem_1fr] items-start gap-3 p-2.5 text-sm hover:bg-muted/50", c.kind === "change" && "bg-amber-500/5")}>
                      <Checkbox checked={s.fields.has(c.field)} onCheckedChange={(v) => toggle(c.field, v === true)} className="mt-0.5" />
                      <span>{c.label}<span className={cn("block text-xs", KIND_CLASS[c.kind])}>{KIND_TEXT[c.kind]}</span></span>
                      <span className="min-w-0 break-words">
                        {c.kind !== "fill" && <span className="block text-muted-foreground line-through">{show(c.field, c.current)}</span>}
                        {show(c.field, c.proposed)}
                      </span>
                    </label>
                  ))}
                  {opt.stage_change && (
                    <label className={cn("grid cursor-pointer grid-cols-[auto_8rem_1fr] items-start gap-3 p-2.5 text-sm hover:bg-muted/50", opt.stage_change.kind === "change" && "bg-amber-500/5")}>
                      <Checkbox checked={s.stage} onCheckedChange={(v) => update(i, { stage: v === true })} className="mt-0.5" />
                      <span>Stage<span className={cn("block text-xs", KIND_CLASS[opt.stage_change.kind])}>{KIND_TEXT[opt.stage_change.kind]}</span></span>
                      <span>
                        {opt.stage_change.current && <span className="block text-muted-foreground line-through">{label(opt.stage_change.current)}</span>}
                        {label(opt.stage_change.proposed)}{opt.stage_change.at ? ` (on ${fmtDate(opt.stage_change.at)})` : ""}
                      </span>
                    </label>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
      {summary && (
        <div className="space-y-2 text-sm">
          <div>
            Will {[
              summary.creates && `create ${summary.creates} application(s)`,
              summary.updates && `update ${summary.updates}`,
              summary.fills && `fill ${summary.fills} empty field(s)`,
              summary.appends && `add to ${summary.appends}`,
            ].filter(Boolean).join(", ") || "change nothing"}.
          </div>
          {summary.overwrites.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4 text-amber-600" /> You will modify existing data:</div>
              <ul className="mt-1 list-disc pl-6">{summary.overwrites.map((o) => <li key={o}>{o}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={apply} disabled={busy}>{busy ? "Saving…" : summary?.overwrites.length ? "Apply, including overwrites" : "Apply"}</Button>
        <Button variant="ghost" onClick={() => setRecords(null)}>Back to text</Button>
      </div>
    </div>
  );
}
