import { useMemo, type ReactNode } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, GanttChart } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { api, fmtDate, fmtTime, localDay, type ActivityItem, type Process } from "../api";
import { useCampaign } from "../campaign";
import { Loading, PageHeader, StatusDot } from "../components/common";
import { interviewName, talkWith } from "../InterviewNotes";
import { STATUS_META } from "../lib/status";
import { useOpenEditor } from "../NotesEditor";
import { useAsync } from "../useAsync";

// Days are "YYYY-MM-DD" strings in the app's timezone; arithmetic goes through UTC midnights.
const DAY_MS = 86_400_000;
const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (d: string) => (new Date(utc(d)).getUTCDay() + 6) % 7; // Monday = 0
const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY_MS);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The board's status colors, except a first reply (amber: sky is too close to applied's blue).
const KIND: Record<string, { label: string; dot: string }> = {
  applied: { label: "applied", dot: STATUS_META.applied.dot },
  reply: { label: "first reply", dot: "bg-amber-500" },
  rejected: { label: "rejected", dot: STATUS_META.rejected.dot },
  withdrawn: { label: "withdrew", dot: STATUS_META.withdrawn.dot },
  offer: { label: "offer", dot: STATUS_META.offer.dot },
};
const isMeeting = (i: ActivityItem): i is Extract<ActivityItem, { kind: "interview" | "talk" }> => i.kind === "interview" || i.kind === "talk";
const who = (i: ActivityItem) => (i.kind === "talk" ? `Talk · ${talkWith(i) ?? ""}` : i.company);

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "processes" ? "processes" : "month";
  const { selected: campaign } = useCampaign();
  const { data, error, loading } = useAsync(() => api.activity(campaign), [campaign]);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        description="What happened when, and how long each process has taken"
        actions={
          <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && set({ view: v === "month" ? null : v })} aria-label="View">
            <ToggleGroupItem value="month"><CalendarRange /> Month</ToggleGroupItem>
            <ToggleGroupItem value="processes"><GanttChart /> Processes</ToggleGroupItem>
          </ToggleGroup>
        }
      />
      {!data ? (
        <Loading error={error} loading={loading} rows={6} />
      ) : view === "month" ? (
        <MonthView items={data.items} month={params.get("month")} day={params.get("day")} set={set} />
      ) : (
        <ProcessesView processes={data.processes} hideClosed={params.get("closed") === "hide"} set={set} />
      )}
    </>
  );
}

type Set = (patch: Record<string, string | null>) => void;

function Dot({ className }: { className: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} />;
}

function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{children}</div>;
}

const meetingChip = (upcoming: boolean, talk: boolean) =>
  cn(
    "rounded px-1.5 text-xs leading-5",
    talk ? "bg-muted text-muted-foreground" : upcoming ? "text-violet-700 ring-1 ring-violet-500/60 ring-inset dark:text-violet-300" : "bg-violet-500/15 text-violet-800 dark:text-violet-200",
  );

function MonthView({ items, month, day, set }: { items: ActivityItem[]; month: string | null; day: string | null; set: Set }) {
  const openEditor = useOpenEditor();
  const today = localDay(new Date());
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  const selected = day ?? (today.startsWith(ym) ? today : null);
  const byDay = useMemo(() => {
    const m = new Map<string, ActivityItem[]>();
    for (const i of items) {
      const d = localDay(i.at);
      m.set(d, [...(m.get(d) ?? []), i]);
    }
    return m;
  }, [items]);

  const first = `${ym}-01`;
  const last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
  const start = addDays(first, -weekday(first));
  const days = Array.from({ length: daysBetween(start, addDays(last, 6 - weekday(last))) + 1 }, (_, i) => addDays(start, i));
  const shift = (n: number) => {
    const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
    set({ month: d === today.slice(0, 7) ? null : d, day: null });
  };
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(utc(first)));
  const dayItems = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">{title}</h2>
          <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft /></Button>
          <Button variant="outline" size="sm" onClick={() => set({ month: null, day: null })}>Today</Button>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => shift(1)}><ChevronRight /></Button>
        </div>
        <Legend>
          <span className="inline-flex items-center gap-1.5"><span className={meetingChip(false, false)}>10:00</span> interview</span>
          <span className="inline-flex items-center gap-1.5"><span className={meetingChip(true, false)}>10:00</span> scheduled</span>
          {Object.values(KIND).map((k) => <span key={k.label} className="inline-flex items-center gap-1.5"><Dot className={k.dot} />{k.label}</span>)}
        </Legend>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs text-muted-foreground">
            {WEEKDAYS.map((w) => <div key={w} className="py-1.5">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const its = byDay.get(d) ?? [];
              const meetings = its.filter(isMeeting);
              const counts = Object.keys(KIND).map((k) => [k, its.filter((i) => i.kind === k).length] as const).filter(([, n]) => n);
              const out = !d.startsWith(ym);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => set({ day: d, month: ym === today.slice(0, 7) ? null : ym })}
                  aria-pressed={d === selected}
                  aria-label={`${fmtDate(d)}: ${its.length ? `${its.length} things` : "nothing"}`}
                  className={cn(
                    "flex min-h-24 flex-col gap-1 border-r border-b p-1.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-h-28 [&:nth-child(7n)]:border-r-0",
                    out && "bg-muted/20 text-muted-foreground",
                    d === selected && "bg-primary/5 ring-2 ring-primary/40 ring-inset",
                  )}
                >
                  <span className={cn("grid size-6 place-items-center rounded-full text-xs tabular-nums", d === today && "bg-primary font-semibold text-primary-foreground")}>
                    {+d.slice(8)}
                  </span>
                  {meetings.slice(0, 3).map((m) => (
                    <span key={m.id} className={cn(meetingChip(m.upcoming, m.kind === "talk"), "hidden truncate sm:block")}>
                      <span className="tabular-nums">{fmtTime(m.at)}</span> {who(m)}
                    </span>
                  ))}
                  {meetings.length > 3 && <span className="hidden text-xs text-muted-foreground sm:block">+{meetings.length - 3} more</span>}
                  {meetings.length > 0 && <span className="flex gap-0.5 sm:hidden">{meetings.map((m) => <Dot key={m.id} className="bg-violet-500" />)}</span>}
                  {counts.length > 0 && (
                    <span className="mt-auto flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs">
                      {counts.map(([k, n]) => <span key={k} className="inline-flex items-center gap-1 tabular-nums" title={`${n} ${KIND[k].label}`}><Dot className={KIND[k].dot} />{n}</span>)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Card className="h-fit lg:sticky lg:top-6">
        <CardContent className="space-y-3">
          <h3 className="font-medium">{selected ? fmtDate(selected) : "Pick a day"}</h3>
          {selected && dayItems.length === 0 && <p className="text-sm text-muted-foreground">Nothing that day.</p>}
          <ul className="space-y-2">
            {dayItems.map((i, n) =>
              isMeeting(i) ? (
                <li key={n}>
                  <button type="button" onClick={() => openEditor("interview", i.interview_id)} className="group flex w-full items-start gap-2 text-left text-sm">
                    <span className={cn(meetingChip(i.upcoming, i.kind === "talk"), "shrink-0 tabular-nums")}>{fmtTime(i.at)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:underline">{who(i)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{interviewName(i)}{i.kind === "interview" ? ` · ${i.role}` : ""}</span>
                    </span>
                  </button>
                </li>
              ) : (
                <li key={n}>
                  <Link to={`/applications/${i.application_id}`} className="group flex items-start gap-2 text-sm">
                    <Dot className={cn(KIND[i.kind].dot, "mt-1.5")} />
                    <span className="min-w-0">
                      <span className="block truncate group-hover:underline"><span className="font-medium">{i.company}</span> · {KIND[i.kind].label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{i.role}</span>
                    </span>
                  </Link>
                </li>
              ),
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

const END_CAP: Partial<Record<Process["status"], string>> = {
  rejected: STATUS_META.rejected.dot,
  withdrawn: STATUS_META.withdrawn.dot,
  offer: STATUS_META.offer.dot,
  ghosted: STATUS_META.ghosted.dot,
};
const OUTCOME_TEXT: Record<string, string> = {
  advanced: "went on to another round",
  rejected: "rejected after it",
  withdrew: "withdrew after it",
  no_answer: "no answer after it",
  waiting: "waiting to hear back",
};

/** Each application as a bar from applied to its final answer (or today), with its interviews on it. */
function ProcessesView({ processes, hideClosed, set }: { processes: Process[]; hideClosed: boolean; set: Set }) {
  const openEditor = useOpenEditor();
  const today = localDay(new Date());
  const open = (p: Process) => !p.ended_at && p.status !== "ghosted";
  const rows = [...processes.filter(open), ...(hideClosed ? [] : processes.filter((p) => !open(p)))];
  const dated = processes.filter((p) => p.applied_at);
  if (!dated.length) return <p className="text-sm text-muted-foreground">No applications in this campaign yet.</p>;

  const start = dated.map((p) => localDay(p.applied_at!)).sort()[0];
  const lastIv = processes.flatMap((p) => p.interviews.map((i) => localDay(i.at))).sort().at(-1) ?? today;
  const end = addDays(lastIv > today ? lastIv : today, 2);
  const span = daysBetween(start, end) + 1;
  const x = (d: string, mid = false) => `${((daysBetween(start, d) + (mid ? 0.5 : 0)) / span) * 100}%`;
  const width = (a: string, b: string) => `${((daysBetween(a, b) + 1) / span) * 100}%`;
  const mondays = Array.from({ length: span }, (_, i) => addDays(start, i)).filter((d) => weekday(d) === 0);
  const closedCount = processes.length - processes.filter(open).length;

  const ticks = (
    <>
      {mondays.map((m) => <div key={m} className="absolute inset-y-0 w-px bg-border/70" style={{ left: x(m) }} />)}
      <div className="absolute inset-y-0 w-0.5 bg-primary/50" style={{ left: x(today, true) }} />
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Legend>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-(--flow-screening)" /> moving</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-(--flow-screening) opacity-30" /> quiet since the last news</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-muted-foreground/30" /> closed</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-amber-500" /> first reply</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-violet-500" /> interview</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full ring-2 ring-violet-500 ring-inset" /> scheduled</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-primary/50" /> today</span>
        </Legend>
        {closedCount > 0 && (
          <Button variant={hideClosed ? "secondary" : "ghost"} size="sm" className="ml-auto" aria-pressed={hideClosed} onClick={() => set({ closed: hideClosed ? null : "hide" })}>
            Hide closed ({closedCount})
          </Button>
        )}
      </div>
      <Card className="py-3">
        <CardContent className="overflow-x-auto px-3">
          <div className="min-w-2xl">
            <div className="grid grid-cols-[minmax(8rem,13rem)_1fr_5rem] gap-3 pb-1 text-xs text-muted-foreground">
              <span />
              <div className="relative h-4">
                {mondays.map((m) => <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(m) }}>{fmtDate(m).slice(0, 6)}</span>)}
              </div>
              <span className="text-right">Days</span>
            </div>
            <div className="divide-y">
              {rows.map((p) => {
                const applied = p.applied_at ? localDay(p.applied_at) : null;
                // A ghosted process stopped at its last news; an open one runs to today.
                const endDay = p.ended_at ? localDay(p.ended_at) : p.status === "ghosted" && p.last_event_at ? localDay(p.last_event_at) : today;
                const lastNews = p.last_event_at && open(p) ? localDay(p.last_event_at) : endDay;
                return (
                  <div key={p.application_id} className="grid grid-cols-[minmax(8rem,13rem)_1fr_5rem] items-center gap-3 py-1">
                    <Link to={`/applications/${p.application_id}`} className="group min-w-0 text-sm">
                      <span className="flex items-center gap-1.5"><StatusDot status={p.status} /><span className="truncate font-medium group-hover:underline">{p.company}</span></span>
                      <span className="block truncate pl-3.5 text-xs text-muted-foreground">{p.role}</span>
                    </Link>
                    <div className="relative h-8">
                      {ticks}
                      {applied && (
                        <>
                          {open(p) ? (
                            <>
                              <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-(--flow-screening)" style={{ left: x(applied), width: width(applied, lastNews) }} />
                              {lastNews < today && (
                                <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-r-full bg-(--flow-screening) opacity-30" style={{ left: x(addDays(lastNews, 1)), width: width(addDays(lastNews, 1), today) }} />
                              )}
                            </>
                          ) : (
                            <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted-foreground/30" style={{ left: x(applied), width: width(applied, endDay) }} />
                          )}
                          {END_CAP[p.status] && (
                            <span
                              className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm ring-2 ring-card", END_CAP[p.status])}
                              style={{ left: x(endDay, true) }}
                              title={`${STATUS_META[p.status].label} · ${fmtDate(p.ended_at ?? p.last_event_at)}`}
                            />
                          )}
                        </>
                      )}
                      {p.reply_at && (
                        <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-amber-500" style={{ left: x(localDay(p.reply_at), true) }} title={`First reply · ${fmtDate(p.reply_at)}`} />
                      )}
                      {p.interviews.map((iv) => (
                        <button
                          key={iv.id}
                          type="button"
                          onClick={() => openEditor("interview", iv.id)}
                          aria-label={`${interviewName(iv)} · ${fmtDate(iv.at, true)}${iv.outcome ? ` · ${OUTCOME_TEXT[iv.outcome]}` : ""}`}
                          title={`${interviewName(iv)} · ${fmtDate(iv.at, true)}${iv.outcome ? ` · ${OUTCOME_TEXT[iv.outcome]}` : ""}`}
                          className="absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          style={{ left: x(localDay(iv.at), true) }}
                        >
                          <span className={cn("size-3 rounded-full ring-2", iv.upcoming ? "bg-card ring-violet-500" : "bg-violet-500 ring-card")} />
                        </button>
                      ))}
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-medium tabular-nums">{p.days ?? "—"} d</div>
                      <div className="text-muted-foreground">
                        {open(p) ? (p.quiet_days ? `quiet ${p.quiet_days} d` : "news today") : STATUS_META[p.status].label.toLowerCase()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
