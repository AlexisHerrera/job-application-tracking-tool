import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { STAGES, api, daysAgo, fmtDate, fmtSalary, label, type Stage, type TimelineEvent } from "../api";
import { Card, Loading, StatusBadge } from "../components";
import { PasteAssistant } from "../PasteAssistant";
import { useAsync } from "../useAsync";

export default function ApplicationDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: app, error, loading, reload } = useAsync(() => api.application(id), [id]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!app) return <Loading error={error} loading={loading} />;

  async function remove() {
    if (!app) return;
    await api.deleteApplication(app.id);
    navigate("/applications");
  }

  return (
    <div className="grid">
      <Card
        title={<>{app.company} <StatusBadge status={app.status} /></>}
        actions={app.needs_review ? (
          <button onClick={async () => { await api.markReviewed(app.id); reload(); }}>Looks right</button>
        ) : undefined}
      >
        {app.needs_review && (
          <p className="warn">Created automatically from an email. Check the company and role, then confirm.</p>
        )}
        <dl className="facts">
          <dt>Role</dt><dd>{app.role_title}</dd>
          <dt>Applied</dt><dd>{fmtDate(app.applied_at)} <span className="muted">({daysAgo(app.applied_at)})</span></dd>
          <dt>Stage</dt><dd>{label(app.current_stage)}{app.current_round ? ` · round ${app.current_round}` : ""} <span className="muted">(furthest: {label(app.max_stage_reached)})</span></dd>
          {app.next_interview_at && <><dt>Next interview</dt><dd><strong>{fmtDate(app.next_interview_at, true)}</strong></dd></>}
          <dt>Source</dt><dd>{[app.source_ats, app.source_channel].filter(Boolean).join(" · ") || "—"}</dd>
          {app.seniority && <><dt>Seniority</dt><dd>{app.seniority}</dd></>}
          {app.stack.length > 0 && <><dt>Stack</dt><dd>{app.stack.join(", ")}</dd></>}
          {fmtSalary(app) && <><dt>Salary</dt><dd>{fmtSalary(app)}</dd></>}
          {app.benefits && <><dt>Other benefits</dt><dd>{app.benefits}</dd></>}
          {app.location && <><dt>Location</dt><dd>{app.location}</dd></>}
          {app.job_url && <><dt>Posting</dt><dd><a href={app.job_url} target="_blank" rel="noreferrer">{app.job_url}</a></dd></>}
          {app.aliases.length > 0 && <><dt>Matches mail from</dt><dd className="small">{app.aliases.map((a) => a.value).join(", ")}</dd></>}
          {app.notes && <><dt>Notes</dt><dd>{app.notes}</dd></>}
        </dl>
        <StageForm appId={app.id} current={app.current_stage} onDone={reload} />
      </Card>

      <Card title="Paste more info">
        <PasteAssistant applicationId={app.id} onApplied={reload} />
      </Card>

      <Card title="Timeline">
        {app.events.length === 0 ? <p className="muted">No events yet. Emails will show up here.</p> : (
          <ol className="timeline">
            {[...app.events].reverse().map((e) => <EventItem key={e.id} e={e} />)}
          </ol>
        )}
      </Card>

      <Card title="Interview notes">
        {app.interview_notes.length === 0 && <p className="muted">No notes yet.</p>}
        {app.interview_notes.map((n) => (
          <div key={n.id} className="note">
            <div className="title">
              Round {n.round ?? "?"} · {n.interview_type ?? "interview"} · {fmtDate(n.interview_at)}
              {n.self_rating ? ` · ${"★".repeat(n.self_rating)}${"☆".repeat(5 - n.self_rating)}` : ""}
            </div>
            {n.questions.length > 0 && <ul>{n.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
            {n.went_well && <p><strong>Went well:</strong> {n.went_well}</p>}
            {n.went_wrong && <p><strong>Went wrong:</strong> {n.went_wrong}</p>}
            {n.topics_to_study.length > 0 && <p><strong>Study:</strong> {n.topics_to_study.join(", ")}</p>}
            <button className="link" onClick={async () => { await api.deleteNote(n.id); reload(); }}>delete</button>
          </div>
        ))}
        <NoteForm appId={app.id} round={app.current_round} onDone={reload} />
      </Card>

      <p>
        <Link to="/applications">← all applications</Link> ·{" "}
        {confirmDelete ? (
          <>
            Delete it? Its emails go back to the inbox.{" "}
            <button className="link danger" onClick={remove}>yes, delete</button>{" "}
            <button className="link" onClick={() => setConfirmDelete(false)}>cancel</button>
          </>
        ) : (
          <button className="link danger" onClick={() => setConfirmDelete(true)}>delete application</button>
        )}
      </p>
    </div>
  );
}

function EventItem({ e }: { e: TimelineEvent }) {
  return (
    <li>
      <div className="small muted">{fmtDate(e.occurred_at, true)} · {e.kind === "manual" ? "manual" : e.from_name || e.from_address}</div>
      <div>
        <strong>{label(e.event_type === "manual_stage_change" ? `→ ${e.stage_implied}` : e.event_type)}</strong>
        {e.round ? ` (round ${e.round})` : ""}
        {e.interview_at && <> · {fmtDate(e.interview_at, true)}</>}
        {e.needs_reply && !e.replied_at && <span className="badge badge-review">reply needed</span>}
      </div>
      {e.subject && <div>{e.subject}</div>}
      {e.summary && <div className="muted small">{e.summary}</div>}
    </li>
  );
}

function StageForm({ appId, current, onDone }: { appId: string; current: Stage; onDone: () => void }) {
  const [stage, setStage] = useState<Stage>(current);
  const [round, setRound] = useState("");
  const [note, setNote] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    await api.changeStage(appId, { stage, round: round ? Number(round) : null, note: note || undefined });
    setNote("");
    onDone();
  }
  return (
    <form className="inline" onSubmit={submit}>
      <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
        {STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
      </select>
      <input type="number" min={1} max={20} placeholder="round" value={round} onChange={(e) => setRound(e.target.value)} />
      <input placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="submit">Set stage</button>
    </form>
  );
}

function NoteForm({ appId, round, onDone }: { appId: string; round: number | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ round: round ? String(round) : "", interview_at: "", interview_type: "technical", questions: "", self_rating: "3", went_well: "", went_wrong: "", topics: "" });
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  if (!open) return <button className="secondary" onClick={() => setOpen(true)}>Add interview note</button>;
  async function submit(e: FormEvent) {
    e.preventDefault();
    await api.addNote(appId, {
      round: f.round ? Number(f.round) : null,
      interview_at: f.interview_at ? `${f.interview_at}T12:00:00-03:00` : null,
      interview_type: f.interview_type,
      questions: lines(f.questions),
      self_rating: Number(f.self_rating),
      went_well: f.went_well || null,
      went_wrong: f.went_wrong || null,
      topics_to_study: f.topics.split(",").map((t) => t.trim()).filter(Boolean),
    });
    setOpen(false);
    onDone();
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="two">
        <label>Round<input type="number" min={1} {...bind("round")} /></label>
        <label>Date<input type="date" {...bind("interview_at")} /></label>
      </div>
      <div className="two">
        <label>Type
          <select {...bind("interview_type")}>
            {["recruiter", "technical", "system_design", "behavioral", "take_home", "onsite", "other"].map((t) => <option key={t} value={t}>{label(t)}</option>)}
          </select>
        </label>
        <label>Self-rating (1–5)<input type="number" min={1} max={5} {...bind("self_rating")} /></label>
      </div>
      <label>Questions asked (one per line)<textarea rows={3} {...bind("questions")} /></label>
      <label>What went well<textarea rows={2} {...bind("went_well")} /></label>
      <label>What went wrong<textarea rows={2} {...bind("went_wrong")} /></label>
      <label>Topics to study (comma separated)<input {...bind("topics")} /></label>
      <div className="actions"><button type="submit">Save note</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
