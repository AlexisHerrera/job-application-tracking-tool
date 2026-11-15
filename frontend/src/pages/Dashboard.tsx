import { useState, type ReactNode } from "react";
import { CalendarCheck, CalendarClock, CalendarDays, Check, ChevronRight, Hourglass, Inbox, MessageSquareReply, NotebookPen, Sparkles, Video, Waypoints } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, daysAgo, errorText, fmtDate, fmtTime, relativeDay, type Interview, type Status } from "../api";
import { interviewName, talkWith } from "@/lib/interviews";
import { useCampaign } from "../campaign";
import { FlowChart } from "../components/FlowChart";
import { InterviewTypesCard } from "../components/Insights";
import { MiniCalendar } from "../components/MiniCalendar";
import { Empty, Loading, PageHeader } from "../components/common";
import { ACTIVE_STATUSES } from "../lib/status";
import { useRefresh } from "../lib/refresh";
import { ReviewDialog } from "../ReviewDialog";
import { useAsync } from "../useAsync";

export default function DashboardPage() {
  const { selected: campaign } = useCampaign();
  const { bump } = useRefresh();
  const { data, error, loading } = useAsync(api.dashboard);
  const stats = useAsync(() => api.stats(campaign), [campaign]).data;
  const insights = useAsync(() => api.insights(campaign), [campaign]).data;
  const [reviewing, setReviewing] = useState(false);
  const navigate = useNavigate();
  if (!data) return <Loading error={error} loading={loading} rows={4} />;
  const { upcoming_interviews: upcoming, recent_interviews: recent, follow_ups: fu } = data;
  const c = data.campaign;

  const active = stats ? Object.entries(stats.by_status).reduce((n, [s, k]) => n + (ACTIVE_STATUSES.has(s as Status) ? k : 0), 0) : null;
  const interviews = stats?.funnel.find((f) => f.stage === "interviewing");

  // Beside the calendar the column is narrower, so four across waits for xl.
  const tiles = (
    <div className={cn("grid grid-cols-2 gap-3", upcoming.length > 0 ? "xl:grid-cols-4" : "lg:grid-cols-4")}>
      <Tile label="Applications" value={stats?.total ?? c?.applications ?? "—"} sub={c ? `day ${c.day} · ${c.per_week} per week` : undefined} />
      <Tile label="Active" value={active ?? "—"} sub="applied, screening, interviewing, on hold" />
      <Tile
        label="Interviews done"
        value={stats?.interviews.done ?? "—"}
        sub={stats ? `${stats.interviews.upcoming} upcoming${interviews ? ` · ${interviews.pct}% of applications got one` : ""}` : undefined}
      />
      <Tile
        label="Days to 1st interview"
        value={c?.days_to_first_interview ?? "—"}
        sub={stats?.time_to_first_response.median_days != null ? `first reply in ${stats.time_to_first_response.median_days} days (median)` : undefined}
      />
    </div>
  );

  async function done(eventId: string) {
    try {
      await api.markReplied(eventId);
      toast.success("Marked as handled");
      bump();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <>
      {/* Title only: the campaign's name is in the sidebar, its day in the first tile. */}
      <PageHeader
        title="Dashboard"
        description={c ? undefined : <>No ongoing campaign. <Link to="/campaigns" className="text-primary hover:underline">Start one</Link> to group this search.</>}
      />

      {/* When something's coming up: the KPI tiles, then the upcoming interviews, with a month
          calendar beside both (a month is about as tall as the two together). */}
      {upcoming.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_17rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {tiles}
            <UpcomingCard upcoming={upcoming} />
          </div>
          <MiniCalendar className="hidden lg:flex" />
        </div>
      ) : (
        tiles
      )}

      {(data.unassigned > 0 || data.needs_review > 0 || data.unassigned_interviews > 0) && (
        <Card className="mt-4 border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {data.needs_review > 0 && (
              <div className="flex flex-1 items-center gap-3">
                <Sparkles className="size-5 shrink-0 text-amber-500" />
                <div className="flex-1 text-sm">
                  <div className="font-medium">{data.needs_review} application{data.needs_review === 1 ? "" : "s"} created from emails</div>
                  <div className="text-muted-foreground">Confirm the company and role. Takes a few seconds each.</div>
                </div>
                <Button size="sm" onClick={() => setReviewing(true)}>Review now</Button>
              </div>
            )}
            {data.unassigned > 0 && (
              <div className="flex flex-1 items-center gap-3">
                <Inbox className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 text-sm">
                  <div className="font-medium">{data.unassigned} unmatched email{data.unassigned === 1 ? "" : "s"}</div>
                  <div className="text-muted-foreground">Couldn't tell which application they belong to.</div>
                </div>
                <Button asChild size="sm" variant="outline"><Link to="/inbox">Open inbox</Link></Button>
              </div>
            )}
            {data.unassigned_interviews > 0 && (
              <div className="flex flex-1 items-center gap-3">
                <CalendarDays className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex-1 text-sm">
                  <div className="font-medium">{data.unassigned_interviews} calendar interview{data.unassigned_interviews === 1 ? "" : "s"} to match</div>
                  <div className="text-muted-foreground">Looks like an interview, but for which application?</div>
                </div>
                <Button asChild size="sm" variant="outline"><Link to="/inbox">Match them</Link></Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}


      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Waypoints className="size-4 text-muted-foreground" /> Where applications went</CardTitle>
        </CardHeader>
        <CardContent>
          {stats ? (
            <FlowChart data={stats.flow} onSelect={(key) => navigate(`/applications?${new URLSearchParams({ view: "all", flow: key })}`)} />
          ) : (
            <Loading error={null} loading rows={1} />
          )}
        </CardContent>
      </Card>

      <div className={`mt-4 grid gap-4 ${upcoming.length > 0 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {upcoming.length === 0 && <ListCard icon={<CalendarClock className="size-4 text-violet-500" />} title="Upcoming interviews" empty="None scheduled.">{[]}</ListCard>}
        <ListCard
          icon={<CalendarCheck className="size-4 text-emerald-600" />}
          title="Just happened"
          description="Last two weeks. Write it down while it's fresh"
          empty="No interviews in the last two weeks."
        >
          {recent.map((i) => (
            <Row
              key={i.id}
              to={`?interview=${i.id}`}
              title={who(i)}
              sub={`${interviewName(i)} · ${relativeDay(i.starts_at)}`}
              right={
                i.notes_count > 0 ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><NotebookPen className="size-3.5" />{i.notes_count}</span>
                ) : (
                  <span className="rounded-full bg-amber-500/10 px-2 leading-5 text-amber-800 dark:text-amber-300">add notes</span>
                )
              }
            />
          ))}
        </ListCard>
        <ListCard
          icon={<MessageSquareReply className="size-4 text-amber-500" />}
          title="Waiting on your reply"
          description="Open requests on active processes"
          empty="Nothing pending."
        >
          {fu.needs_reply.map((r) => (
            <div key={r.event_id} className="flex items-center gap-2 py-2">
              <Link to={r.application_id ? `/applications?open=${r.application_id}` : "/inbox"} className="min-w-0 flex-1 rounded-md hover:underline">
                <div className="truncate text-sm font-medium">{r.company ?? "Unassigned"}</div>
                <div className="truncate text-xs text-muted-foreground">{r.subject} · {daysAgo(r.received_at)}</div>
              </Link>
              <Button size="xs" variant="outline" onClick={() => done(r.event_id)} aria-label={`Mark ${r.company ?? "email"} as handled`}>
                <Check /> Done
              </Button>
            </div>
          ))}
        </ListCard>
        <ListCard icon={<Hourglass className="size-4 text-muted-foreground" />} title="No news for a while" description="Worth a nudge before they go quiet" empty="Nothing quiet yet.">
          {fu.no_news.map((r) => (
            <Row key={r.application_id} to={`/applications?open=${r.application_id}`} title={r.company} sub={r.role} right={<span className="text-muted-foreground">{daysAgo(r.last_event_at)}</span>} />
          ))}
        </ListCard>
      </div>


      {insights && <div className="mt-4"><InterviewTypesCard data={insights} /></div>}

      <ReviewDialog open={reviewing} onOpenChange={setReviewing} />
    </>
  );
}

const who = (i: Interview) => (i.general ? `General talk · ${talkWith(i) ?? ""}` : i.company ?? "?");

function JoinButton({ i, size = "icon-xs" }: { i: Interview; size?: "icon-xs" | "sm" }) {
  if (!i.meeting_url) return null;
  return (
    <Button asChild variant={size === "sm" ? "default" : "ghost"} size={size} aria-label={`Join the ${i.company ?? ""} call`}>
      <a href={i.meeting_url} target="_blank" rel="noreferrer"><Video />{size === "sm" && " Join call"}</a>
    </Button>
  );
}

/** The next interview up front, then the rest. */
function UpcomingCard({ upcoming }: { upcoming: Interview[] }) {
  const [next, ...rest] = upcoming;
  const when = relativeDay(next.starts_at);
  return (
    <Card className="border-violet-500/30 bg-violet-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-violet-500" /> Upcoming interviews</CardTitle>
        <CardAction><span className="text-sm text-muted-foreground tabular-nums">{upcoming.length}</span></CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link to={`?interview=${next.id}`} className="group flex min-w-0 flex-1 items-center gap-4">
            <div className="shrink-0 rounded-lg border bg-card px-3 py-1.5 text-center">
              <div className="text-xs font-medium text-violet-600 capitalize dark:text-violet-300">{when}</div>
              <div className="text-xl font-semibold tabular-nums">{fmtTime(next.starts_at)}</div>
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold group-hover:underline">{who(next)}</div>
              <div className="truncate text-sm text-muted-foreground">
                {next.general ? interviewName(next) : `${interviewName(next)}${next.role ? ` · ${next.role}` : ""}`}
              </div>
              <div className="text-xs text-muted-foreground">{fmtDate(next.starts_at)}</div>
            </div>
          </Link>
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" variant="outline"><Link to={`?interview=${next.id}`}><NotebookPen /> Notes</Link></Button>
            <JoinButton i={next} size="sm" />
          </div>
        </div>
        {rest.length > 0 && (
          <div className="mt-3 divide-y border-t">
            {rest.map((i) => (
              <div key={i.id} className="flex items-center gap-1">
                <Row
                  to={`?interview=${i.id}`}
                  title={who(i)}
                  sub={i.general ? interviewName(i) : `${interviewName(i)} · ${i.role ?? ""}`}
                  right={<span className="text-right"><span className="block font-medium">{fmtDate(i.starts_at, true)}</span><span className="text-muted-foreground">{relativeDay(i.starts_at)}</span></span>}
                />
                <JoinButton i={i} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ListCard({ icon, title, description, empty, children }: { icon: ReactNode; title: string; description?: string; empty: string; children: ReactNode[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {children.length > 0 && <CardAction><span className="text-sm text-muted-foreground tabular-nums">{children.length}</span></CardAction>}
      </CardHeader>
      <CardContent>
        {children.length === 0 ? <Empty>{empty}</Empty> : <div className="divide-y">{children}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ to, title, sub, right }: { to: string; title: string; sub: string; right: ReactNode }) {
  return (
    <Link to={to} className="group flex min-w-0 flex-1 items-center gap-2 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium group-hover:underline">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="shrink-0 text-xs">{right}</div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
