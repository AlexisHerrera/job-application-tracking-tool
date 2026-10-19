import { useMemo, useState } from "react";
import { api, fmtDate, label, type ApplicationInput, type FieldChange, type PasteOption, type PasteRecord } from "./api";

// Review-before-write flow: the AI only proposes. Fills are preselected; anything that would
// overwrite a value you already have starts unchecked and is called out before applying.

type Selection = { option: number; fields: Set<string>; stage: boolean; skip: boolean; role: string };

const KIND_TEXT: Record<FieldChange["kind"], string> = {
  fill: "fills empty",
  append: "adds to",
  change: "⚠ will modify",
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
      <div className="form">
        <p className="muted small">
          Paste anything: emails, Slack or LinkedIn messages, a job post, your own notes. The AI proposes{" "}
          {applicationId ? "updates to this application" : "new applications or updates to existing ones"}; you review every
          change before anything is saved. The pasted text itself is not stored.
        </p>
        <textarea rows={applicationId ? 5 : 10} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"e.g. \"Applied to Northwind (Senior Backend) on Sep 3 via referral. Recruiter said 90–110k USD + equity. Rejected after the system design round on Oct 2.\""} />
        <div className="actions">
          <button onClick={read} disabled={busy || !text.trim()}>{busy ? "Reading…" : "Read with AI"}</button>
        </div>
        {error && <p className="error">{error}</p>}
        {done && <p className="ok">{done}</p>}
      </div>
    );
  }

  return (
    <div className="form">
      {records.length === 0 && <p className="muted">The AI didn't find any application details in that text.</p>}
      {records.map((rec, i) => {
        const s = sel[i];
        const opt = rec.options[s.option];
        const isNew = opt.application_id === null;
        const hasRole = opt.changes.some((c) => c.field === "role_title" && s.fields.has(c.field));
        return (
          <div key={i} className={`proposal${s.skip ? " skipped" : ""}`}>
            <div className="proposal-head">
              <strong>{rec.company}</strong>
              {rec.options.length > 1 ? (
                <select value={s.option} onChange={(e) => {
                  const option = Number(e.target.value);
                  update(i, { option, ...defaults(rec.options[option]) });
                }}>
                  {rec.options.map((o, j) => <option key={j} value={j}>{o.label}</option>)}
                </select>
              ) : <span className="muted small">{opt.label}</span>}
              <label className="check small"><input type="checkbox" checked={s.skip} onChange={(e) => update(i, { skip: e.target.checked })} />skip</label>
            </div>
            {rec.evidence && <div className="muted small">“{rec.evidence}”</div>}
            {rec.salary_note && <div className="muted small">Salary {rec.salary_note}.</div>}
            {!s.skip && (
              <>
                {opt.changes.length === 0 && !opt.stage_change && <p className="muted small">Nothing new for this application.</p>}
                {isNew && !hasRole && (
                  <label>Role (required)<input value={s.role} onChange={(e) => update(i, { role: e.target.value })} /></label>
                )}
                <table className="changes">
                  <tbody>
                    {opt.changes.map((c) => (
                      <tr key={c.field} className={`kind-${c.kind}`}>
                        <td>
                          <input type="checkbox" checked={s.fields.has(c.field)} onChange={(e) => {
                            const fields = new Set(s.fields);
                            if (e.target.checked) fields.add(c.field);
                            else fields.delete(c.field);
                            update(i, { fields });
                          }} />
                        </td>
                        <td>{c.label}<div className={`kind kind-${c.kind}`}>{KIND_TEXT[c.kind]}</div></td>
                        <td>
                          {c.kind !== "fill" && <div className="current">{show(c.field, c.current)}</div>}
                          <div>{show(c.field, c.proposed)}</div>
                        </td>
                      </tr>
                    ))}
                    {opt.stage_change && (
                      <tr className={`kind-${opt.stage_change.kind}`}>
                        <td><input type="checkbox" checked={s.stage} onChange={(e) => update(i, { stage: e.target.checked })} /></td>
                        <td>Stage<div className={`kind kind-${opt.stage_change.kind}`}>{KIND_TEXT[opt.stage_change.kind]}</div></td>
                        <td>
                          {opt.stage_change.current && <div className="current">{label(opt.stage_change.current)}</div>}
                          <div>{label(opt.stage_change.proposed)}{opt.stage_change.at ? ` (on ${fmtDate(opt.stage_change.at)})` : ""}</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        );
      })}
      {summary && (
        <div className="apply-summary">
          <div>
            Will {[
              summary.creates && `create ${summary.creates} application(s)`,
              summary.updates && `update ${summary.updates}`,
              summary.fills && `fill ${summary.fills} empty field(s)`,
              summary.appends && `add to ${summary.appends}`,
            ].filter(Boolean).join(", ") || "change nothing"}.
          </div>
          {summary.overwrites.length > 0 && (
            <div className="warn">
              <strong>You will modify existing data:</strong>
              <ul>{summary.overwrites.map((o) => <li key={o}>{o}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button onClick={apply} disabled={busy}>{busy ? "Saving…" : summary?.overwrites.length ? "Apply, including overwrites" : "Apply"}</button>
        <button className="secondary" onClick={() => setRecords(null)}>Back to text</button>
      </div>
    </div>
  );
}
