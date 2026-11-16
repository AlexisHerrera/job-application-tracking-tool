import { Inbox } from "lucide-react";
import { Link } from "react-router-dom";
import type { DiscoveryInsights } from "@/api/discoveryInsights";
import { Empty } from "@/components/common";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HIDE_REASON_LABELS } from "@/features/discovery/hideReasons";
import { DayChart } from "@/pages/discover-insights/charts/DayChart";
import { POSTING_SERIES } from "@/pages/discover-insights/constants";
import { SourceRows } from "./SourceRows";

/** What the sources stored each day, and how much of it reached the review queue. */
export function NewPostingsCard({ data }: { data: DiscoveryInsights }) {
  const p = data.postings;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Inbox className="size-4 text-muted-foreground" /> New postings</CardTitle>
        <CardDescription>Stored each day, and whether they reached the review queue or the rules hid them, as they stand now. A source's first run brings everything it lists, so that day stands out.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {p.total === 0 ? (
          <Empty>No new postings in the last {data.days.length} days. Runs collect them every 6 hours in prod; locally, run one from Review.</Empty>
        ) : (
          <>
            <DayChart days={data.days} rows={p.days} series={POSTING_SERIES} noun="new postings" />
            {p.hidden_by.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Hidden by{" "}
                {p.hidden_by.map(([reason, n], i) => (
                  <span key={reason}>
                    {i > 0 && " · "}
                    {HIDE_REASON_LABELS[reason] ?? reason} <span className="font-medium text-foreground tabular-nums">{n.toLocaleString()}</span>
                  </span>
                ))}
                . <Link to="/discover/criteria?tab=rules" className="text-primary hover:underline">See the rules</Link>
              </p>
            )}
            <SourceRows sources={p.sources} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
