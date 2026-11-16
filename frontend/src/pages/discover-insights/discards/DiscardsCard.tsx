import { useState } from "react";
import { MessageSquareX } from "lucide-react";
import { Link } from "react-router-dom";
import type { DiscoveryInsights } from "@/api/discoveryInsights";
import { Empty } from "@/components/common";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { plural } from "@/pages/discover-insights/format";
import { ReasonGroup } from "./ReasonGroup";
import { SourceQualityTable } from "./SourceQualityTable";

const THIN = 10; // below this many discards with a reason, say why few hints show

/** Why postings were discarded, by the reason picked, each with the change it points to. */
export function DiscardsCard({ data }: { data: DiscoveryInsights }) {
  const d = data.discards;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (r: string) => setOpen((s) => new Set(s.has(r) ? [...s].filter((x) => x !== r) : [...s, r]));
  const withReason = d.total - d.without_reason;
  const max = Math.max(1, ...d.reasons.map((r) => r.count));
  const role = d.reasons.filter((r) => r.about === "criteria");
  const posting = d.reasons.filter((r) => r.about === "source");
  const group = { max, open, onToggle: toggle };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquareX className="size-4 text-muted-foreground" /> Why postings were discarded</CardTitle>
        <CardDescription>By the reason picked when discarding, each with the rule or criteria change it points to. Open a reason for its split by source, board, seniority and company, and the notes you left.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {d.total === 0 ? (
          <Empty>Nothing discarded in the last {data.days.length} days.</Empty>
        ) : withReason === 0 ? (
          <Empty>
            {plural(d.total, "posting")} discarded, none with a reason. Pick one when you discard (keys 1–9 in <Link to="/discover" className="text-primary hover:underline">Review</Link>), and each reason shows up here with the change it points to.
          </Empty>
        ) : (
          <>
            {(withReason < THIN || d.without_reason > 0) && (
              <p className="text-xs text-muted-foreground">
                {withReason < THIN && <>Only {plural(withReason, "discard")} with a reason so far. A change is suggested once at least two discards share something (a word, a place, a technology), so most show up after a few dozen. </>}
                {d.without_reason > 0 && <>{plural(d.without_reason, "more was", "more were")} discarded without a reason.</>}
              </p>
            )}
            {role.length > 0 && <ReasonGroup title="The role and its conditions" hint="These point at the criteria the AI reads and the rules that hide postings before it." rows={role} {...group} />}
            {posting.length > 0 && <ReasonGroup title="The posting itself" hint="These say more about the sources than about the criteria." rows={posting} {...group} />}
            {d.sources.length > 0 && <SourceQualityTable rows={d.sources} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
