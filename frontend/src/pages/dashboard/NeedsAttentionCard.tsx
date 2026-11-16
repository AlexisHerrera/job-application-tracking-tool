import { CalendarDays, Inbox, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Dashboard } from "@/api";
import { AttentionItem } from "./AttentionItem";

/** Applications to review, unmatched emails, calendar interviews to match. Hidden when there are none. */
export function NeedsAttentionCard({ data, onReview }: { data: Dashboard; onReview: () => void }) {
  if (!(data.unassigned > 0 || data.needs_review > 0 || data.unassigned_interviews > 0)) return null;
  return (
    <Card className="mt-4 border-amber-500/30 bg-amber-500/5">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {data.needs_review > 0 && (
          <AttentionItem
            icon={<Sparkles className="size-5 shrink-0 text-amber-500" />}
            title={`${data.needs_review} application${data.needs_review === 1 ? "" : "s"} created from emails`}
            description="Confirm the company and role. Takes a few seconds each."
            action={<Button size="sm" onClick={onReview}>Review now</Button>}
          />
        )}
        {data.unassigned > 0 && (
          <AttentionItem
            icon={<Inbox className="size-5 shrink-0 text-muted-foreground" />}
            title={`${data.unassigned} unmatched email${data.unassigned === 1 ? "" : "s"}`}
            description="Couldn't tell which application they belong to."
            action={<Button asChild size="sm" variant="outline"><Link to="/inbox">Open inbox</Link></Button>}
          />
        )}
        {data.unassigned_interviews > 0 && (
          <AttentionItem
            icon={<CalendarDays className="size-5 shrink-0 text-muted-foreground" />}
            title={`${data.unassigned_interviews} calendar interview${data.unassigned_interviews === 1 ? "" : "s"} to match`}
            description="Looks like an interview, but for which application?"
            action={<Button asChild size="sm" variant="outline"><Link to="/inbox">Match them</Link></Button>}
          />
        )}
      </CardContent>
    </Card>
  );
}
