import { Link } from "react-router-dom";
import type { DiscoveryInsights } from "@/api/discoveryInsights";
import { StatTile } from "@/components/StatTile";
import { pct } from "./format";

/** The window in four numbers: new postings, reviewed, applied, and the queue now. */
export function InsightTiles({ data }: { data: DiscoveryInsights }) {
  const { postings: p, reviews: r } = data;
  // A pace from a handful of reviews would say thousands of days: wait for a few.
  const daysLeft = r.total >= 10 ? Math.ceil(r.waiting / (r.total / data.days.length)) : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="New postings" value={p.total.toLocaleString()} sub={p.total ? `${p.queue.toLocaleString()} reached the queue · ${pct(p.hidden, p.total)} hidden` : "none in this window"} />
      <StatTile label="Reviewed" value={r.total.toLocaleString()} sub={r.total ? `${r.saved} saved · ${r.applied} applied · ${r.discarded} discarded` : "none in this window"} />
      <StatTile label="Applied" value={r.applied.toLocaleString()} sub={r.applied ? `${pct(r.applied, r.total)} of what you reviewed` : "from Review, none yet"} />
      <StatTile
        label="Waiting in Review"
        value={<Link to="/discover" className="hover:underline">{r.waiting.toLocaleString()}</Link>}
        sub={daysLeft !== null && r.waiting > 0 ? `about ${daysLeft.toLocaleString()} days at this window's pace` : "the review queue now"}
      />
    </div>
  );
}
