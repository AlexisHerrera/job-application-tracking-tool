import { ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import type { DiscoveryInsights } from "@/api/discoveryInsights";
import { Empty } from "@/components/common";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DayChart } from "@/pages/discover-insights/charts/DayChart";
import { REVIEW_SERIES } from "@/pages/discover-insights/constants";
import { plural } from "@/pages/discover-insights/format";

/** What left the review queue each day: saved, applied or discarded. */
export function ReviewsCard({ data }: { data: DiscoveryInsights }) {
  const r = data.reviews;
  const busy = r.days.filter((d) => d.saved + d.applied + d.discarded > 0).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListChecks className="size-4 text-muted-foreground" /> Reviewed</CardTitle>
        <CardDescription>Postings that left the review queue each day, by what they are now: one saved and applied to later counts as applied, on the day it was saved.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {r.total === 0 ? (
          <Empty>
            Nothing reviewed in the last {data.days.length} days.
            {r.waiting > 0 && <> <Link to="/discover" className="text-primary hover:underline">{plural(r.waiting, "posting")} {r.waiting === 1 ? "is" : "are"} waiting in Review</Link>.</>}
          </Empty>
        ) : (
          <>
            <DayChart days={data.days} rows={r.days} series={REVIEW_SERIES} noun="reviews" />
            {busy < 3 && <p className="text-xs text-muted-foreground">All of it on {plural(busy, "day")} so far: the chart fills in as you review.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
