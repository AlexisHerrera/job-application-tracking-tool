import { CalendarClock } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, relativeDay } from "@/lib/format";
import { type Interview } from "@/api/interviews";
import { interviewName } from "@/lib/interviews";
import { JoinCallButton } from "./JoinCallButton";
import { ListRow } from "./ListRow";
import { NextInterview } from "./NextInterview";
import { who } from "./who";

/** The next interview up front, then the rest. */
export function UpcomingInterviewsCard({ upcoming }: { upcoming: Interview[] }) {
  const [next, ...rest] = upcoming;
  return (
    <Card className="border-violet-500/30 bg-violet-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-violet-500" /> Upcoming interviews</CardTitle>
        <CardAction><span className="text-sm text-muted-foreground tabular-nums">{upcoming.length}</span></CardAction>
      </CardHeader>
      <CardContent>
        <NextInterview next={next} />
        {rest.length > 0 && (
          <div className="mt-3 divide-y border-t">
            {rest.map((i) => (
              <div key={i.id} className="flex items-center gap-1">
                <ListRow
                  to={`?interview=${i.id}`}
                  title={who(i)}
                  sub={i.general ? interviewName(i) : `${interviewName(i)} · ${i.role ?? ""}`}
                  right={<span className="text-right"><span className="block font-medium">{fmtDate(i.starts_at, true)}</span><span className="text-muted-foreground">{relativeDay(i.starts_at)}</span></span>}
                />
                <JoinCallButton i={i} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
