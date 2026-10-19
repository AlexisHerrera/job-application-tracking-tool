import { Link, useSearchParams } from "react-router-dom";
import { api, fmtDate, label } from "../api";
import { useCampaign } from "../campaign";
import { Loading, StatusBadge } from "../components";
import { useAsync } from "../useAsync";

const FILTERS = ["all", "active", "applied", "screening", "interviewing", "offer", "rejected", "withdrawn", "ghosted"];
const ACTIVE = "applied,screening,interviewing";

export default function Applications() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const q = params.get("q") ?? "";
  const review = params.get("needs_review") === "true";

  const { selected: campaign } = useCampaign();
  const query: Record<string, string> = { campaign };
  if (status !== "all") query.status = status === "active" ? ACTIVE : status;
  if (q) query.q = q;
  if (review) query.needs_review = "true";
  const { data, error, loading } = useAsync(() => api.applications(query), [status, q, review, campaign]);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search company or role" value={q} onChange={(e) => set("q", e.target.value || null)} />
        <label className="check">
          <input type="checkbox" checked={review} onChange={(e) => set("needs_review", e.target.checked ? "true" : null)} />
          To review
        </label>
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f} className={f === status ? "chip active" : "chip"} onClick={() => set("status", f === "all" ? null : f)}>
            {label(f)}
          </button>
        ))}
      </div>
      <Loading error={error} loading={loading && !data} />
      {data && data.length === 0 && <p className="muted">No applications match. <Link to="/add">Add one</Link>.</p>}
      {data && data.length > 0 && (
        <ul className="list">
          {data.map((a) => (
            <li key={a.id}>
              <Link to={`/applications/${a.id}`} className="row">
                <div>
                  <div className="title">
                    {a.company} {a.needs_review && <span className="badge badge-review">review</span>}
                  </div>
                  <div className="muted">{a.role_title}</div>
                </div>
                <div className="right">
                  <StatusBadge status={a.status} />
                  {a.current_round ? <span className="muted"> r{a.current_round}</span> : null}
                  <div className="muted small">
                    {a.next_interview_at ? `next: ${fmtDate(a.next_interview_at, true)}` : `applied ${fmtDate(a.applied_at)}`}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
