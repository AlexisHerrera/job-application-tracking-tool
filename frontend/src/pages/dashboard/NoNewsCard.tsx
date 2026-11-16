import { Hourglass } from "lucide-react";
import { daysAgo } from "@/lib/format";
import { type Dashboard } from "@/api/dashboard";
import { ListCard } from "./ListCard";
import { ListRow } from "./ListRow";

/** Active applications that have gone quiet. */
export function NoNewsCard({ noNews }: { noNews: Dashboard["follow_ups"]["no_news"] }) {
  return (
    <ListCard icon={<Hourglass className="size-4 text-muted-foreground" />} title="No news for a while" description="Worth a nudge before they go quiet" empty="Nothing quiet yet.">
      {noNews.map((r) => (
        <ListRow key={r.application_id} to={`/applications?open=${r.application_id}`} title={r.company} sub={r.role} right={<span className="text-muted-foreground">{daysAgo(r.last_event_at)}</span>} />
      ))}
    </ListCard>
  );
}
