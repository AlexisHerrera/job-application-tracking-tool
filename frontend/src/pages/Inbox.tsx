import { useState } from "react";
import { api, fmtDate, label, type Application, type TimelineEvent } from "../api";
import { ApplicationForm } from "../ApplicationForm";
import { Card, Loading } from "../components";
import { useAsync } from "../useAsync";

export default function Inbox() {
  const inbox = useAsync(api.inbox);
  const apps = useAsync(() => api.applications());
  if (!inbox.data || !apps.data) return <Loading error={inbox.error ?? apps.error} loading />;
  if (inbox.data.length === 0) return <Card title="Unassigned emails"><p className="muted">Inbox zero: every job email is matched.</p></Card>;

  return (
    <Card title={`Unassigned emails (${inbox.data.length})`}>
      <p className="muted small">Assigning teaches the matcher: the sender gets linked to that company, so its next emails resolve automatically.</p>
      <ul className="list">
        {inbox.data.map((e) => <InboxItem key={e.id} e={e} apps={apps.data!} onDone={inbox.reload} />)}
      </ul>
    </Card>
  );
}

function InboxItem({ e, apps, onDone }: { e: TimelineEvent; apps: Application[]; onDone: () => void }) {
  const suggested = apps.filter((a) => a.company === (e.company_hint ?? e.extracted_company));
  const [target, setTarget] = useState(suggested[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <li className="inbox-item">
      <div className="small muted">{fmtDate(e.occurred_at, true)} · {e.from_name} &lt;{e.from_address}&gt;</div>
      <div className="title">{e.subject}</div>
      <div>
        <strong>{label(e.event_type)}</strong>
        {e.extracted_company && <> · looks like <em>{e.extracted_company}</em></>}
        {e.extracted_role && <> / {e.extracted_role}</>}
        {e.confidence != null && <span className="muted"> · {Math.round(e.confidence * 100)}% sure</span>}
      </div>
      {e.summary && <div className="muted small">{e.summary}</div>}
      <div className="inline">
        <select value={target} onChange={(ev) => setTarget(ev.target.value)}>
          <option value="">Assign to…</option>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.company} · {a.role_title}</option>)}
        </select>
        <button disabled={!target} onClick={() => run(() => api.assign(e.id, target))}>Assign</button>
        <button className="secondary" onClick={() => setCreating(!creating)}>New application</button>
        <button className="secondary" onClick={() => run(() => api.dismiss(e.id))}>Not a job email</button>
      </div>
      {error && <p className="error">{error}</p>}
      {creating && (
        <ApplicationForm
          initial={{ company: e.extracted_company ?? e.company_hint ?? "", role_title: e.extracted_role ?? "", applied_at: e.occurred_at }}
          submitLabel="Create and assign"
          showStage={false}
          onSubmit={async (data) => { await api.createFromEvent(e.id, data); onDone(); }}
        />
      )}
    </li>
  );
}
