import { useState, type FormEvent } from "react";
import { api, fmtDate, type CampaignSummary } from "../api";
import { useCampaign } from "../campaign";
import { Card } from "../components";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });

export default function Campaigns() {
  const { campaigns, reload } = useCampaign();
  const [form, setForm] = useState({ name: "", started_on: today(), notes: "" });
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(() => api.createCampaign({ name: form.name, started_on: form.started_on, notes: form.notes || null }));
    setForm({ name: "", started_on: today(), notes: "" });
  }

  return (
    <div className="grid">
      {campaigns.map((c) => <CampaignCard key={c.id} c={c} run={run} />)}
      <Card title="Start a new campaign">
        <form className="form" onSubmit={create}>
          <div className="two">
            <label>Name<input required placeholder="Spring 2027" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Starts on<input type="date" required value={form.started_on} onChange={(e) => setForm({ ...form, started_on: e.target.value })} /></label>
          </div>
          <label>Notes<input placeholder="Goals, target roles…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <p className="muted small">An ongoing earlier campaign ends the day before. Applications join a campaign by their applied date.</p>
          <button type="submit">Start campaign</button>
        </form>
      </Card>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CampaignCard({ c, run }: { c: CampaignSummary; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: c.name, started_on: c.started_on, ended_on: c.ended_on ?? "" });
  return (
    <Card
      title={<>{c.name} {c.ongoing ? <span className="badge badge-interviewing">ongoing</span> : <span className="badge badge-withdrawn">ended</span>}</>}
      actions={<button className="secondary" onClick={() => setEditing(!editing)}>{editing ? "Close" : "Edit"}</button>}
    >
      <div className="stats-row">
        <div><strong>{c.day}</strong><span>days</span></div>
        <div><strong>{c.applications}</strong><span>applications</span></div>
        <div><strong>{c.per_week}</strong><span>per week</span></div>
        <div><strong>{c.days_to_first_interview ?? "—"}</strong><span>days to 1st interview</span></div>
      </div>
      <p className="muted small">
        {fmtDate(c.started_on)} → {c.ended_on ? fmtDate(c.ended_on) : "ongoing"}
        {c.first_interview_on && <> · first interview {fmtDate(c.first_interview_on)}</>}
        {c.first_response_on && <> · first response {fmtDate(c.first_response_on)}</>}
      </p>
      {c.notes && <p>{c.notes}</p>}
      {editing && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void run(() => api.updateCampaign(c.id, { ...f, ended_on: f.ended_on || null })); }}>
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <div className="two">
            <label>Starts on<input type="date" value={f.started_on} onChange={(e) => setF({ ...f, started_on: e.target.value })} /></label>
            <label>Ends on (empty = ongoing)<input type="date" value={f.ended_on} onChange={(e) => setF({ ...f, ended_on: e.target.value })} /></label>
          </div>
          <div className="actions">
            <button type="submit">Save</button>
            {c.ongoing && <button type="button" className="secondary" onClick={() => run(() => api.updateCampaign(c.id, { ended_on: today() }))}>End today</button>}
            <button type="button" className="link danger" onClick={() => run(() => api.deleteCampaign(c.id))}>delete (applications stay)</button>
          </div>
        </form>
      )}
    </Card>
  );
}
