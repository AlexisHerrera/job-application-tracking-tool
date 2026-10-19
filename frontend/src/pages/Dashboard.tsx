import { Link } from "react-router-dom";
import { api, daysAgo, fmtDate } from "../api";
import { Card, Loading } from "../components";
import { useAsync } from "../useAsync";

export default function DashboardPage() {
  const { data, error, loading } = useAsync(api.dashboard);
  if (!data) return <Loading error={error} loading={loading} />;
  const { upcoming_interviews: upcoming, follow_ups: fu } = data;

  return (
    <div className="grid">
      {(data.unassigned > 0 || data.needs_review > 0) && (
        <Card title="Needs your attention">
          <ul className="plain">
            {data.unassigned > 0 && (
              <li><Link to="/inbox">{data.unassigned} email(s) couldn't be matched to an application</Link></li>
            )}
            {data.needs_review > 0 && (
              <li>
                <Link to="/applications?needs_review=true">
                  {data.needs_review} application(s) were created from emails: check they're right
                </Link>
              </li>
            )}
          </ul>
        </Card>
      )}
      <Card title="Upcoming interviews">
        {upcoming.length === 0 ? <p className="muted">None scheduled.</p> : (
          <ul className="plain">
            {upcoming.map((i) => (
              <li key={i.application_id}>
                <strong>{fmtDate(i.at, true)}</strong> · <Link to={`/applications/${i.application_id}`}>{i.company}</Link>{" "}
                <span className="muted">{i.role}{i.round ? ` · round ${i.round}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Waiting on your reply">
        {fu.needs_reply.length === 0 ? <p className="muted">Nothing pending.</p> : (
          <ul className="plain">
            {fu.needs_reply.map((r) => (
              <li key={r.event_id}>
                {r.application_id ? <Link to={`/applications/${r.application_id}`}>{r.company}</Link> : <Link to="/inbox">unassigned</Link>}{" "}
                · {r.subject} <span className="muted">({daysAgo(r.received_at)})</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="No news for a while">
        {fu.no_news.length === 0 ? <p className="muted">All quiet processes are already marked ghosted.</p> : (
          <ul className="plain">
            {fu.no_news.map((r) => (
              <li key={r.application_id}>
                <Link to={`/applications/${r.application_id}`}>{r.company}</Link> · {r.role}{" "}
                <span className="muted">(last: {daysAgo(r.last_event_at)})</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
