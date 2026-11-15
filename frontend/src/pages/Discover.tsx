// Job discovery (plan §20, §21): new openings from the saved searches and the watched companies'
// job boards, scored by the LLM against the criteria. Everything in a posting comes from the web: rendered as text, links only if http(s).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, Download, ExternalLink, Loader2, Play, Plus, RefreshCw, Search, Settings2, Sparkles, Star, Telescope, ThumbsDown, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  api,
  daysAgo,
  errorText,
  label,
  timeAgo,
  type DiscoveryProgress,
  type DiscoveryRules,
  type DiscoveryRun,
  type DiscoverySearch,
  type DiscoveryState,
  type Facet,
  type Posting,
  type PostingPage,
  type PostingStatus,
  type SearchSource,
} from "../api";
import { Empty, Loading, PageHeader } from "../components/common";
import { useAsync } from "../useAsync";

type View = "match" | "maybe" | "no" | "unscored" | "all" | "hidden";
type StatusFilter = "open" | "interested" | "applied" | "dismissed" | "any";

const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "match", label: "Matches" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
  { value: "unscored", label: "Not scored" },
  { value: "hidden", label: "Hidden" },
];

const PAGE_SIZE = 50;
// URL param → API param. The filters live in the URL, so they survive opening an application
// and coming back.
const FILTER_PARAMS: Record<string, string> = {
  source: "source",
  q: "q",
  loc: "location",
  pub: "publisher",
  sen: "seniority",
  size: "company_size",
  sector: "sector",
  mode: "work_mode",
  fit: "location_fit",
  emp: "employer_kind",
  tech: "tech",
  salary: "salary_min",
  posted: "posted_days",
};

const SENIORITY: Record<string, string> = { junior: "Junior", mid: "Mid", semi_senior: "Semi senior", senior: "Senior", staff_plus: "Staff+", unclear: "Unclear" };
const COMPANY_SIZE: Record<string, string> = {
  startup: "Startup (<50)",
  small: "Small (50–250)",
  medium: "Medium (250–1k)",
  large: "Large (1k+)",
  unclear: "Unclear",
};
const SECTOR: Record<string, string> = {
  fintech: "Fintech",
  ai: "AI",
  security: "Security",
  devtools: "Dev tools",
  saas: "SaaS / business software",
  ecommerce: "E-commerce",
  health: "Health",
  education: "Education",
  crypto: "Crypto",
  media: "Media",
  gaming: "Gaming",
  logistics: "Logistics & travel",
  hr: "HR & recruiting",
  government: "Government & non-profit",
  consulting: "Consulting",
  other: "Other",
  unclear: "Unclear",
};
const WORK_MODE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unclear: "Unclear" };
const LOCATION_FIT: Record<string, string> = { yes: "Location fits", no: "Location doesn't fit", unclear: "Location unclear" };
const EMPLOYER: Record<string, string> = { direct: "Hiring directly", agency: "Agency", consultancy: "Consultancy", unclear: "Unclear" };
const POSTED = [
  { value: "", label: "Posted any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last week" },
  { value: "14", label: "Last 2 weeks" },
  { value: "30", label: "Last month" },
];

function queryFor(params: URLSearchParams): Record<string, string> {
  const view = (params.get("view") ?? "all") as View;
  const status = (params.get("status") ?? "open") as StatusFilter;
  const q: Record<string, string> = {};
  if (view === "hidden") q.hidden = "true";
  else if (view !== "all") q.verdict = view;
  if (status === "open") q.status = "new,interested";
  else if (status !== "any") q.status = status;
  for (const [key, apiKey] of Object.entries(FILTER_PARAMS)) {
    const v = params.get(key);
    if (v) q[apiKey] = v;
  }
  if (params.get("ai") === "1") q.ai = "true";
  q.sort = params.get("sort") ?? "score";
  q.limit = String(PAGE_SIZE);
  q.offset = String(pageOf(params) * PAGE_SIZE);
  return q;
}

const pageOf = (params: URLSearchParams) => Math.max(0, Number(params.get("page") ?? "0") || 0);
const techsOf = (params: URLSearchParams) => (params.get("tech") ?? "").split(",").filter(Boolean);

const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

export default function Discover() {
  const [params, setParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const state = useAsync(api.discoverySettings);
  const list = useAsync(() => api.postings(queryFor(params)), [params.toString()]);

  const view = (params.get("view") ?? "all") as View;
  const status = (params.get("status") ?? "open") as StatusFilter;
  const page = pageOf(params);
  // One setParams call per change: several in a row would each start from the same old params.
  const update = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!("page" in changes)) next.delete("page");
        return next;
      },
      { replace: true },
    );
  const set = (key: string, value: string | null) => update({ [key]: value });
  const addTech = (t: string) => {
    const techs = techsOf(params);
    if (!techs.some((x) => x.toLowerCase() === t.toLowerCase())) set("tech", [...techs, t].join(","));
  };

  const reloadAll = () => {
    void state.reload();
    void list.reload();
  };
  const s = state.data;
  const data = list.data;

  // Runs and re-scores wait for one long request; meanwhile the progress endpoint says where it is.
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useDiscoveryProgress(job !== null);
  const working = job !== null || progress?.running === true;
  const wasRunning = useRef(false);
  useEffect(() => {
    // A run this page didn't start (it was reloaded mid-run): refresh when it ends.
    if (wasRunning.current && !progress?.running && job === null) reloadAll();
    wasRunning.current = progress?.running === true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.running]);

  async function start(next: Job) {
    if (working) return;
    setProgress(null);
    setJob(next);
    try {
      const r = next.kind === "run" ? await api.runDiscovery(next.score, next.collect) : await api.rescorePostings(next.includeHidden);
      const msg = next.kind === "rescore" ? `${r.llm_calls} postings scored` : `${r.new} new · ${r.dropped} hidden · ${next.score ? `${r.llm_calls} scored` : "not scored"}`;
      if (r.errors) toast.warning(`${msg}. ${r.notes.join(" · ")}`);
      else toast.success(msg);
      reloadAll();
    } catch (e) {
      toast.error(errorText(e));
    }
    setJob(null);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Discover"
        description="New openings from your saved searches and watched companies, scored against your criteria."
        actions={
          s && (
            <>
              <RunButton state={s} working={working} onRun={(score, collect) => void start({ kind: "run", score, collect })} />
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 /> Criteria & searches
              </Button>
            </>
          )
        }
      />

      {working ? (
        <ProgressPanel p={progress} kind={job ? (job.kind === "run" && !job.collect ? "score" : job.kind) : (progress?.kind ?? "run")} collectOnly={job?.kind === "run" && !job.score} />
      ) : (
        s && <LastRun run={s.last_run} used={s.jsearch_used_this_month} cap={s.rules.jsearch_monthly_cap} jsearchOn={s.searches.some((x) => x.enabled && x.source === "jsearch")} />
      )}

      {s && s.searches.length === 0 && s.companies.total === 0 ? (
        <Empty icon={<Telescope className="size-8" />}>
          <p>No saved searches yet.</p>
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api.seedDiscovery();
                toast.success("Loaded the default searches, criteria and company watchlist. Review them, then run.");
                reloadAll();
                setSettingsOpen(true);
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          >
            Load the defaults
          </Button>
        </Empty>
      ) : (
        <>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && set("view", v === "all" ? null : v)} aria-label="Verdict">
              {VIEWS.map((v) => (
                <ToggleGroupItem key={v.value} value={v.value}>
                  {v.label}
                  {v.value === "hidden" && data ? ` · ${data.counts.hidden}` : ""}
                  {v.value === "unscored" && data && data.counts.unscored ? ` · ${data.counts.unscored}` : ""}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <NativeSelect size="sm" value={status} onChange={(e) => set("status", e.target.value === "open" ? null : e.target.value)} aria-label="Status">
              <NativeSelectOption value="open">To look at</NativeSelectOption>
              <NativeSelectOption value="interested">Interested</NativeSelectOption>
              <NativeSelectOption value="applied">Applied</NativeSelectOption>
              <NativeSelectOption value="dismissed">Not for me</NativeSelectOption>
              <NativeSelectOption value="any">Any status</NativeSelectOption>
            </NativeSelect>
            <NativeSelect size="sm" value={params.get("sort") ?? "score"} onChange={(e) => set("sort", e.target.value === "score" ? null : e.target.value)} aria-label="Sort">
              <NativeSelectOption value="score">Best fit first</NativeSelectOption>
              <NativeSelectOption value="posted">Newest first</NativeSelectOption>
              <NativeSelectOption value="salary">Best paid first</NativeSelectOption>
            </NativeSelect>
          </div>

          <Filters params={params} set={set} update={update} facets={data?.facets} />

          {!data ? (
            <Loading error={list.error} loading={list.loading} />
          ) : data.postings.length === 0 ? (
            <Empty icon={<Telescope className="size-8" />}>
              {data.counts.total === 0 ? "Nothing collected yet. Run the searches to fill this page." : "Nothing here with these filters."}
            </Empty>
          ) : (
            <div className={cn("space-y-3 transition-opacity", list.loading && "opacity-60")}>
              <p className="text-xs text-muted-foreground">
                {data.total} posting{data.total === 1 ? "" : "s"}
                {data.total > PAGE_SIZE && ` · showing ${page * PAGE_SIZE + 1}–${Math.min(data.total, (page + 1) * PAGE_SIZE)}`}
              </p>
              {data.postings.map((p) => (
                <PostingCard key={p.id} p={p} onChange={() => void list.reload()} onBlocked={reloadAll} onTech={addTech} />
              ))}
              {data.total > PAGE_SIZE && (
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => set("page", page > 1 ? String(page - 1) : null)}>
                    <ChevronLeft /> Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= data.total} onClick={() => set("page", String(page + 1))}>
                    Next <ChevronRight />
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {s && (
        <SettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          state={s}
          onSaved={reloadAll}
          working={working}
          onRescore={(includeHidden) => {
            setSettingsOpen(false);
            void start({ kind: "rescore", includeHidden });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Search and filters

function Filters({
  params,
  set,
  update,
  facets,
}: {
  params: URLSearchParams;
  set: (key: string, value: string | null) => void;
  update: (changes: Record<string, string | null>) => void;
  facets: PostingPage["facets"] | undefined;
}) {
  const active = Object.keys(FILTER_PARAMS).filter((k) => params.get(k)).length + (params.get("ai") === "1" ? 1 : 0);
  const facet = (key: string, all: string, options: Facet | undefined, names: Record<string, string>) => (
    <FacetSelect value={params.get(key) ?? ""} onChange={(v) => set(key, v || null)} all={all} options={options ?? []} names={names} />
  );
  const clear = () => update(Object.fromEntries([...Object.keys(FILTER_PARAMS), "ai"].map((k) => [k, null])));

  return (
    <div className="mb-4 space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap gap-2">
        <TextFilter value={params.get("q") ?? ""} onChange={(v) => set("q", v || null)} placeholder="Title or company" className="min-w-48 flex-[2]" icon />
        <TextFilter value={params.get("loc") ?? ""} onChange={(v) => set("loc", v || null)} placeholder="Location, e.g. Buenos Aires" className="min-w-44 flex-1" />
        <TextFilter
          value={params.get("salary") ?? ""}
          onChange={(v) => set("salary", v.replace(/\D/g, "") || null)}
          placeholder="Min salary, USD/yr"
          className="w-40"
          inputMode="numeric"
          title="Only postings that state a salary (in USD, or converted to a year) with a top of at least this"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FacetSelect value={params.get("pub") ?? ""} onChange={(v) => set("pub", v || null)} all="Any job board" options={facets?.publisher ?? []} />
        <NativeSelect size="sm" value={params.get("source") ?? ""} onChange={(e) => set("source", e.target.value || null)} aria-label="Source" className={cn(params.get("source") && "[&_select]:border-primary")}>
          <NativeSelectOption value="">All sources</NativeSelectOption>
          <NativeSelectOption value="remoteyeah">remoteyeah</NativeSelectOption>
          <NativeSelectOption value="getonbrd">getonbrd</NativeSelectOption>
          <NativeSelectOption value="workable">Workable</NativeSelectOption>
          <NativeSelectOption value="ashby">Company boards · Ashby</NativeSelectOption>
          <NativeSelectOption value="greenhouse">Company boards · Greenhouse</NativeSelectOption>
          <NativeSelectOption value="lever">Company boards · Lever</NativeSelectOption>
          <NativeSelectOption value="jsearch">JSearch</NativeSelectOption>
        </NativeSelect>
        {facet("sen", "Any seniority", facets?.seniority, SENIORITY)}
        <TechPicker selected={techsOf(params)} options={facets?.technologies ?? []} onChange={(t) => set("tech", t.join(",") || null)} />
        {facet("size", "Any company size", facets?.company_size, COMPANY_SIZE)}
        {facet("sector", "Any sector", facets?.sector, SECTOR)}
        {facet("mode", "Remote, hybrid or on-site", facets?.work_mode, WORK_MODE)}
        {facet("fit", "Any location fit", facets?.location_fit, LOCATION_FIT)}
        {facet("emp", "Any employer", facets?.employer_kind, EMPLOYER)}
        <NativeSelect size="sm" value={params.get("posted") ?? ""} onChange={(e) => set("posted", e.target.value || null)} aria-label="Posted" className={cn(params.get("posted") && "[&_select]:border-primary")}>
          {POSTED.map((o) => (
            <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-1.5 text-sm">
          <Checkbox checked={params.get("ai") === "1"} onCheckedChange={(c) => set("ai", c === true ? "1" : null)} /> AI roles
        </label>
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={clear} className="text-muted-foreground">
            <X /> Clear {active} filter{active === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A text box that updates its filter 300 ms after the last keystroke. */
function TextFilter({ value, onChange, placeholder, className, icon, inputMode, title }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; icon?: boolean; inputMode?: "numeric"; title?: string }) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  // Follow the URL only when something else changed it ("Clear filters"), never while typing.
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === sent.current) return;
    const t = setTimeout(() => {
      sent.current = text;
      onChange(text);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className={cn("relative", className)}>
      {icon && <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />}
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        inputMode={inputMode}
        title={title}
        className={cn("h-8", icon && "pl-8", value && "border-primary")}
      />
    </div>
  );
}

function FacetSelect({ value, onChange, all, options, names }: { value: string; onChange: (v: string) => void; all: string; options: Facet; names?: Record<string, string> }) {
  // Keep the chosen value listed even when no posting in this view has it.
  const opts: Facet = value && !options.some(([v]) => v === value) ? [...options, [value, 0]] : options;
  return (
    <NativeSelect size="sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={all} className={cn(value && "[&_select]:border-primary")}>
      <NativeSelectOption value="">{all}</NativeSelectOption>
      {opts.map(([v, n]) => (
        <NativeSelectOption key={v} value={v}>
          {names?.[v] ?? label(v)} ({n})
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function TechPicker({ selected, options, onChange }: { selected: string[]; options: Facet; onChange: (techs: string[]) => void }) {
  const isOn = (t: string) => selected.some((x) => x.toLowerCase() === t.toLowerCase());
  const missing: Facet = selected.filter((t) => !options.some(([v]) => v.toLowerCase() === t.toLowerCase())).map((t) => [t, 0]);
  const toggle = (t: string) => onChange(isOn(t) ? selected.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...selected, t]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("max-w-72 font-normal", selected.length > 0 && "border-primary")}>
          <span className="truncate">{selected.length ? selected.join(" + ") : "Any technology"}</span> <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="TypeScript, Python…" />
          <CommandList>
            <CommandEmpty>No posting lists that one.</CommandEmpty>
            <CommandGroup heading={selected.length > 1 ? "Postings that ask for all of these" : "Postings that ask for"}>
              {[...missing, ...options].map(([t, n]) => (
                <CommandItem key={t} value={t} onSelect={() => toggle(t)} data-checked={isOn(t)}>
                  <span className="truncate">{t}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{n}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RunButton({ state, working, onRun }: { state: DiscoveryState; working: boolean; onRun: (score: boolean, collect: boolean) => void }) {
  if (!state.can_run) return null;
  const enabled = state.searches.filter((x) => x.enabled);
  const jsearch = state.jsearch_configured ? enabled.filter((x) => x.source === "jsearch").length : 0;
  const nothing = enabled.length === 0 && state.companies.enabled === 0;
  const sources = `${enabled.length} search${enabled.length === 1 ? "" : "es"} and ${state.companies.enabled} company board${state.companies.enabled === 1 ? "" : "s"}`;
  return (
    <>
      <Button size="sm" variant="outline" disabled={working || nothing} onClick={() => onRun(false, true)} title={`Reads ${sources} and stores what's new. No AI calls: new postings stay unscored.`}>
        <Download /> Collect only
      </Button>
      {state.unscored > 0 && (
        <Button size="sm" variant="outline" disabled={working || !state.llm_configured} onClick={() => onRun(true, false)} title={`Scores the ${state.unscored} postings that are waiting with AI, best location first (paid, about $${(state.unscored * 0.0005).toFixed(2)}). Reads no source.`}>
          <Sparkles /> Score pending ({state.unscored})
        </Button>
      )}
      <Button size="sm" disabled={working || nothing} onClick={() => onRun(true, true)} title={`Reads ${sources}${jsearch ? ` (about ${jsearch} JSearch request${jsearch === 1 ? "" : "s"})` : ""}, then scores up to 1,000 waiting postings with AI (paid, about $0.0005 each)`}>
        <Play className={cn(working && "animate-pulse")} /> {working ? "Running…" : "Run now"}
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Progress of a run or a re-score

type Job = { kind: "run"; score: boolean; collect: boolean } | { kind: "rescore"; includeHidden: boolean };

/** Asks the server every second while `active` (or while it reports a run going). */
function useDiscoveryProgress(active: boolean) {
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let running = false;
      try {
        const r = await api.discoveryProgress();
        if (stopped) return;
        setProgress(r);
        running = r.running;
      } catch {
        // keep the last answer; try again
      }
      if (!stopped && (active || running)) timer = setTimeout(tick, 1000);
    };
    // When a job just started, give the request a moment to reach the server first.
    timer = setTimeout(tick, active ? 400 : 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);
  return [progress, setProgress] as const;
}

function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** "about 40s left", from how long the finished units took. */
function eta(elapsed: number | null | undefined, done: number, total: number): string | null {
  if (!elapsed || done < 1 || done >= total) return null;
  const left = (elapsed / done) * (total - done);
  return left < 10 ? "a few seconds left" : `about ${duration(left)} left`;
}

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

type StepState = "pending" | "active" | "done";

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0">
        {state === "done" ? (
          <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
        ) : state === "active" ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : (
          <Circle className="size-4 text-muted-foreground/50" />
        )}
      </span>
      <div className={cn("min-w-0 flex-1", state === "pending" && "text-muted-foreground")}>
        <div className={cn("text-sm", state === "active" && "font-medium")}>{title}</div>
        {children && <div className="text-xs text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

function ProgressPanel({ p, kind, collectOnly = false }: { p: DiscoveryProgress | null; kind: "run" | "score" | "rescore"; collectOnly?: boolean }) {
  const live = p?.kind ? p : null; // {running: false} alone: nothing reported yet
  const phase = live?.phase;
  const total = live?.searches_total ?? 0;
  const done = live?.searches_done ?? 0;
  const toScore = live?.to_score ?? 0;
  const scored = live?.scored ?? 0;
  const collectState: StepState = !live ? "pending" : phase === "collecting" ? "active" : "done";
  const scoreState: StepState = phase === "scoring" ? "active" : phase === "done" ? "done" : "pending";
  const errors = live?.errors ?? 0;

  return (
    <div className="mb-4 rounded-lg border bg-card p-3" aria-live="polite">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{kind === "run" ? "Finding new openings" : kind === "score" ? "Scoring postings" : "Re-scoring postings"}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {live?.elapsed_s != null ? duration(live.elapsed_s) : "starting…"}
        </span>
      </div>
      <ol className="space-y-2.5">
        {kind === "run" && (
          <Step state={collectState} title={total ? `Collect from your searches and company boards (${Math.min(done, total)} of ${total})` : "Collect from your searches and company boards"}>
            {collectState === "active" && live?.current && (
              <>
                Reading “{live.current}”{eta(live.phase_elapsed_s, done, total) && ` · ${eta(live.phase_elapsed_s, done, total)}`}
                <Bar done={done} total={total} />
              </>
            )}
            {live && (live.fetched ?? 0) > 0 && (
              <div className="mt-1">
                {live.fetched} found · {live.new} new · {live.hidden} hidden by the rules
              </div>
            )}
          </Step>
        )}
        {!collectOnly && <Step state={scoreState} title={scoreState === "pending" || !toScore ? "Score with AI" : `Score with AI (${scored} of ${toScore})`}>
          {scoreState === "active" && (
            toScore === 0 ? (
              "Nothing to score"
            ) : (
              <>
                6 at a time{eta(live?.phase_elapsed_s, scored, toScore) ? ` · ${eta(live?.phase_elapsed_s, scored, toScore)}` : scored === 0 ? " · waiting for the first answers" : ""}
                <Bar done={scored} total={toScore} />
              </>
            )
          )}
        </Step>}
      </ol>
      {errors > 0 && <p className="mt-2 text-xs text-destructive">{errors} error{errors === 1 ? "" : "s"} so far; the rest keeps going.</p>}
      <p className="mt-2.5 text-xs text-muted-foreground">You can leave this page: the run keeps going, and the list refreshes when it ends.</p>
    </div>
  );
}

function LastRun({ run, used, cap, jsearchOn }: { run: DiscoveryRun | null; used: number; cap: number; jsearchOn: boolean }) {
  return (
    <p className="mb-4 text-xs text-muted-foreground">
      {run ? (
        <>
          Last run {timeAgo(run.finished_at ?? run.started_at)}: {run.new} new, {run.dropped} hidden, {run.llm_calls} scored
          {run.errors > 0 && <span className="text-destructive"> · {run.errors} error{run.errors === 1 ? "" : "s"} ({run.notes.join(" · ")})</span>}
        </>
      ) : (
        "Never run."
      )}
      {jsearchOn && <>{" · "}JSearch this month: {used} / {cap}</>}
    </p>
  );
}

function VerdictBadge({ p }: { p: Posting }) {
  if (!p.verdict) return <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-xs text-muted-foreground">not scored</span>;
  const tone = {
    match: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    maybe: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    no: "bg-muted text-muted-foreground",
  }[p.verdict];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium tabular-nums", tone)}>
      {p.verdict} · {p.score}
    </span>
  );
}

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-xs whitespace-nowrap", className)}>{children}</span>;
}

function salaryOf(p: Posting): string | null {
  if (p.salary_text) return p.salary_text;
  if (!p.salary_min && !p.salary_max) return null;
  const n = (v: number) => new Intl.NumberFormat("en-US").format(v);
  const lo = p.salary_min ?? p.salary_max!;
  const hi = p.salary_max ?? p.salary_min!;
  return `${lo === hi ? n(lo) : `${n(lo)}–${n(hi)}`}${p.salary_period ? ` / ${p.salary_period.toLowerCase()}` : ""}`;
}

const DROP_LABEL: Record<string, string> = {
  agency: "agency / marketplace",
  consultancy: "consultancy",
  location: "location",
  "location: brazil onsite": "onsite in Brazil",
  "language: portuguese": "in Portuguese",
  old: "too old",
  salary: "below the salary floor",
  duplicate: "duplicate",
};

function usdSalary(p: Posting): string | null {
  if (!p.salary_usd_max) return null;
  const k = (v: number) => `${Math.round(v / 1000)}k`;
  const lo = p.salary_usd_min ?? p.salary_usd_max;
  return `≈ USD ${lo === p.salary_usd_max ? k(lo) : `${k(lo)}–${k(p.salary_usd_max)}`} / yr`;
}

function PostingCard({ p, onChange, onBlocked, onTech }: { p: Posting; onChange: () => void; onBlocked: () => void; onTech: (tech: string) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const url = safeUrl(p.url);
  const salary = salaryOf(p) ?? usdSalary(p);
  const overlap = new Set(p.stack_overlap.map((t) => t.toLowerCase()));
  const techs = p.technologies.length ? p.technologies : p.stack_overlap;
  const meta = [p.location, salary, p.employment_type, p.posted_at ? `posted ${daysAgo(p.posted_at)}` : null, p.publisher ? `via ${p.publisher}` : null].filter(Boolean);

  async function setStatus(next: PostingStatus) {
    setBusy(true);
    try {
      await api.setPostingStatus(p.id, next);
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
    setBusy(false);
  }
  async function hideCompany() {
    setBusy(true);
    try {
      const r = await api.blockCompany(p.company);
      toast.success(`${p.company} is blocked: ${r.hidden} posting${r.hidden === 1 ? "" : "s"} hidden. Undo it in Criteria & searches, under "Blocked companies".`);
      onBlocked();
    } catch (e) {
      toast.error(errorText(e));
    }
    setBusy(false);
  }
  async function apply() {
    setBusy(true);
    try {
      const r = await api.applyPosting(p.id);
      toast.success(`Added ${r.application.company} to your applications`, {
        action: { label: "Open", onClick: () => navigate(`/applications/${r.application.id}`) },
      });
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
    setBusy(false);
  }

  return (
    <Card className={cn("gap-3 py-4", p.status === "dismissed" && "opacity-60")}>
      <CardContent className="space-y-2.5 px-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge p={p} />
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium break-words hover:underline">
                  {p.title} <ExternalLink className="inline size-3.5 align-[-2px] text-muted-foreground" />
                </a>
              ) : (
                <span className="font-medium break-words">{p.title}</span>
              )}
            </div>
            <div className="mt-0.5 text-sm">
              <span className="font-medium">{p.company}</span>
              {meta.length > 0 && <span className="text-muted-foreground"> · {meta.join(" · ")}</span>}
            </div>
          </div>
          {p.search_label && <span className="text-xs text-muted-foreground">{p.search_label}</span>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {p.drop_reason && <Chip className="border-destructive/30 text-destructive">hidden: {DROP_LABEL[p.drop_reason] ?? p.drop_reason}</Chip>}
          {p.status === "applied" && <Chip className="border-emerald-500/40"><Check className="mr-1 size-3" /> applied</Chip>}
          {p.status === "interested" && <Chip className="border-amber-500/40"><Star className="mr-1 size-3" /> interested</Chip>}
          {p.in_tracker && p.status !== "applied" && <Chip>company already in your tracker</Chip>}
          {p.ai_related && <Chip><Sparkles className="mr-1 size-3" /> AI</Chip>}
          {p.location_fit && p.location_fit !== "unclear" && <Chip>location: {p.location_fit === "yes" ? "fits" : "doesn't fit"}</Chip>}
          {p.seniority && p.seniority !== "unclear" && <Chip>{label(p.seniority)}</Chip>}
          {p.years_required != null && <Chip>{p.years_required}+ years</Chip>}
          {p.employer_kind && p.employer_kind !== "direct" && p.employer_kind !== "unclear" && <Chip>{p.employer_kind}</Chip>}
          {p.work_mode && p.work_mode !== "unclear" && <Chip>{WORK_MODE[p.work_mode] ?? p.work_mode}</Chip>}
          {p.company_size && p.company_size !== "unclear" && <Chip>{COMPANY_SIZE[p.company_size] ?? p.company_size}</Chip>}
          {p.sector && p.sector !== "unclear" && <Chip>{SECTOR[p.sector] ?? p.sector}</Chip>}
        </div>

        {p.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {p.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        {techs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {techs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTech(t)}
                title={`Only postings that ask for ${t}${overlap.has(t.toLowerCase()) ? " (on your CV)" : ""}`}
                className={cn("rounded px-1.5 py-0.5 text-xs hover:ring-1 hover:ring-ring", overlap.has(t.toLowerCase()) ? "bg-primary/15 font-medium" : "bg-muted")}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <Collapsible>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {p.status !== "applied" && (
              <>
                <Button size="sm" disabled={busy} onClick={apply}><Check /> Applied</Button>
                {p.status === "interested" ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("new")}><Star className="fill-current" /> Interested</Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("interested")}><Star /> Interested</Button>
                )}
                {p.status === "dismissed" ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus("new")}>Undo "not for me"</Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus("dismissed")}><ThumbsDown /> Not for me</Button>
                )}
                {p.drop_reason !== "blocked" && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={hideCompany} title={`Never show ${p.company} again: hides its postings and blocks new ones`}><Ban /> Hide company</Button>
                )}
              </>
            )}
            {p.status === "applied" && p.application_id && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/applications/${p.application_id}`)}>Open application</Button>
            )}
            {p.description && (
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground">
                  Description <ChevronDown />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
          <CollapsibleContent>
            <p className="mt-2 max-h-96 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm whitespace-pre-line">{p.description}</p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Criteria, rules and searches

const LIST_FIELDS: { key: keyof DiscoveryRules; label: string; hint: string }[] = [
  { key: "blocked", label: "Blocked companies", hint: "Hidden, whatever the source. \"Hide company\" on a posting adds to this list. One company per line." },
  { key: "agencies", label: "Agencies & talent marketplaces", hint: "Dropped. One company per line." },
  { key: "consultancies", label: "Consultancies", hint: "Hidden. One company per line." },
  { key: "seniority_exclude", label: "Seniority words", hint: "A title with one of these is hidden (junior, intern…)." },
  { key: "role_exclude", label: "Role words", hint: "A title with one of these is hidden, AI titles too (manager, support engineer…)." },
  { key: "title_exclude", label: "Stack words", hint: "Hidden unless the title is about AI. Whole words: \"java\" doesn't hit JavaScript." },
  { key: "location_allow", label: "Locations", hint: "A job is hidden unless its location mentions one of these (no location = kept). Company-board jobs outside these aren't stored at all. Doesn't apply to JSearch." },
];

function SettingsSheet({
  open,
  onOpenChange,
  state,
  onSaved,
  working,
  onRescore,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  state: DiscoveryState;
  onSaved: () => void;
  working: boolean;
  onRescore: (includeHidden: boolean) => void;
}) {
  const [criteria, setCriteria] = useState(state.criteria);
  const [rules, setRules] = useState<DiscoveryRules>(state.rules);
  const [lists, setLists] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [withHidden, setWithHidden] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCriteria(state.criteria);
    setRules(state.rules);
    setLists(Object.fromEntries(LIST_FIELDS.map((f) => [f.key, (state.rules[f.key] as string[]).join("\n")])));
  }, [open, state]);

  async function save() {
    setSaving(true);
    try {
      const parsed = Object.fromEntries(LIST_FIELDS.map((f) => [f.key, (lists[f.key] ?? "").split("\n").map((l) => l.trim()).filter(Boolean)]));
      await api.saveDiscoverySettings({ criteria, rules: { ...rules, ...parsed } });
      toast.success("Saved. New postings use it from the next run.");
      onSaved();
    } catch (e) {
      toast.error(errorText(e));
    }
    setSaving(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Criteria & searches</SheetTitle>
          <SheetDescription>The AI reads the criteria for every new posting. The rules hide postings before any AI call.</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-8">
          <section className="space-y-2">
            <Label htmlFor="criteria">What you're looking for</Label>
            <Textarea id="criteria" rows={16} value={criteria} onChange={(e) => setCriteria(e.target.value)} className="font-mono text-xs" />
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-medium">Rules</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <NumberField label="Max age (days)" value={rules.max_age_days} onChange={(v) => setRules({ ...rules, max_age_days: v ?? 21 })} />
              <NumberField label="Salary floor (USD/yr)" value={rules.salary_floor_usd} placeholder="none" onChange={(v) => setRules({ ...rules, salary_floor_usd: v || null })} />
              <NumberField label="JSearch cap / month" value={rules.jsearch_monthly_cap} onChange={(v) => setRules({ ...rules, jsearch_monthly_cap: v ?? 190 })} />
            </div>
            {LIST_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`rule-${f.key}`}>{f.label}</Label>
                <p className="text-xs text-muted-foreground">{f.hint}</p>
                <Textarea id={`rule-${f.key}`} rows={4} value={lists[f.key] ?? ""} onChange={(e) => setLists({ ...lists, [f.key]: e.target.value })} className="text-xs" />
              </div>
            ))}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save criteria & rules"}</Button>
            {state.can_run && (
              <>
                <Button size="sm" variant="outline" disabled={working} onClick={() => onRescore(withHidden)} title="Scores the postings from the last 3 weeks again with the saved criteria (paid AI calls, about $0.0005 each). Doesn't run the searches, so no JSearch requests.">
                  <RefreshCw /> Re-score recent
                </Button>
                <label className="flex items-center gap-1.5 text-xs" title="Also score the postings the rules hid (not duplicates). They stay hidden, but you'll see their verdict and can filter them.">
                  <Checkbox checked={withHidden} onCheckedChange={(c) => setWithHidden(c === true)} /> hidden ones too
                </label>
              </>
            )}
          </div>

          <Watchlist state={state} onChange={onSaved} />

          <Searches searches={state.searches} jsearchConfigured={state.jsearch_configured} onChange={onSaved} />
        </div>
      </SheetContent>
    </Sheet>
  );

}

function NumberField({ label: text, value, placeholder, onChange }: { label: string; value: number | null; placeholder?: string; onChange: (v: number | null) => void }) {
  const parse = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v)) || 0));
  return (
    <div className="space-y-1">
      <Label className="text-xs">{text}</Label>
      <Input inputMode="numeric" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(parse(e.target.value))} />
    </div>
  );
}

const GETONBRD_CATEGORIES = ["programming", "machine-learning-ai", "mobile-developer", "sysadmin-devops-qa", "data-science-analytics", "cybersecurity", "design-ux", "innovation-agile", "other"];

function Watchlist({ state, onChange }: { state: DiscoveryState; onChange: () => void }) {
  const c = state.companies;
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const r = await api.seedDiscovery();
      toast.success(`Added ${r.added.companies} compan${r.added.companies === 1 ? "y" : "ies"} and ${r.added.searches} search${r.added.searches === 1 ? "" : "es"}.`);
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
    setLoading(false);
  }
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Company boards</h3>
      <p className="text-xs text-muted-foreground">
        Each run reads the public job board of every watched company and keeps the engineering roles in your locations. It's free and needs no key.
      </p>
      <div className="rounded-lg border px-3 py-2 text-sm">
        {c.total === 0 ? (
          "No companies watched yet."
        ) : (
          <>
            <div>
              {c.enabled} compan{c.enabled === 1 ? "y" : "ies"} watched
              <span className="text-muted-foreground"> · Greenhouse {c.by_ats.greenhouse} · Ashby {c.by_ats.ashby} · Lever {c.by_ats.lever}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {c.last_checked_at ? `Last read ${timeAgo(c.last_checked_at)}: ${c.jobs_kept} matching role${c.jobs_kept === 1 ? "" : "s"} at ${c.with_jobs} compan${c.with_jobs === 1 ? "y" : "ies"}` : "Not read yet: run a collection."}
              {c.total > c.enabled && ` · ${c.total - c.enabled} off (board gone)`}
            </div>
            <div className="text-xs text-muted-foreground">
              {c.last_scan_at ? `Board directory scanned for new companies ${timeAgo(c.last_scan_at)}.` : "Board directory not scanned for new companies from here yet."} Worth doing monthly: <code>jobtracker discover companies scan seeds/ats_directory_2026-08.csv</code>
            </div>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={loading} onClick={load} title="Adds the starting list of about 450 companies that had engineering roles in Latin America, and any default search that's missing. Keeps what you already have.">
          <Plus /> {c.total === 0 ? "Load the starting watchlist" : "Add missing defaults"}
        </Button>
        <span className="text-xs text-muted-foreground">Add one company from a terminal: <code>jobtracker discover companies add &lt;its website or board URL&gt;</code></span>
      </div>
    </section>
  );
}

function paramsSummary(x: DiscoverySearch): string {
  if (x.source === "getonbrd") return `category ${String(x.params.category ?? "")}`;
  if (x.source === "remoteyeah") return String(x.params.feed ?? "").replace("https://remoteyeah.com/", "");
  if (x.source === "workable") return [x.params.query && `"${x.params.query}"`, x.params.location].filter(Boolean).join(" · ");
  const parts = [`"${x.params.query}"`];
  if (x.params.country) parts.push(String(x.params.country).toUpperCase());
  if (x.params.work_from_home) parts.push("remote only");
  return parts.join(" · ");
}

function Searches({ searches, jsearchConfigured, onChange }: { searches: DiscoverySearch[]; jsearchConfigured: boolean; onChange: () => void }) {
  const [source, setSource] = useState<SearchSource>("getonbrd");
  const [category, setCategory] = useState("programming");
  const [labelText, setLabelText] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("ar");
  const [remote, setRemote] = useState(false);
  const [feed, setFeed] = useState("https://remoteyeah.com/");
  const [place, setPlace] = useState("Argentina");
  const enabledJsearch = searches.filter((x) => x.enabled && x.source === "jsearch").length;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  async function add() {
    const params: DiscoverySearch["params"] = source === "jsearch" ? { query, country } : source === "workable" ? { query: query.trim(), location: place.trim() } : source === "getonbrd" ? { category } : { feed };
    if (source === "jsearch" && remote) params.work_from_home = true;
    const fallback = source === "jsearch" ? `${country.toUpperCase()} · ${query}` : source === "workable" ? `Workable · ${[query.trim(), place.trim()].filter(Boolean).join(" in ")}` : source === "getonbrd" ? `getonbrd · ${category}` : feed.split("/").pop() ?? "feed";
    await run(async () => {
      await api.addSearch({ source, label: labelText || fallback, params, enabled: true });
      setLabelText("");
      setQuery("");
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Searches</h3>
        <p className="text-xs text-muted-foreground">
          remoteyeah feeds, getonbrd categories and Workable searches are free.
          {enabledJsearch > 0 && ` ${enabledJsearch} JSearch search${enabledJsearch === 1 ? "" : "es"} on: about ${enabledJsearch * 30} of the free 200 requests a month at one run a day.`}
          {enabledJsearch > 0 && !jsearchConfigured && " JSEARCH_API_KEY isn't set, so JSearch searches are skipped."}
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {searches.map((x) => (
          <li key={x.id} className="flex items-center gap-3 px-3 py-2">
            <Checkbox checked={x.enabled} onCheckedChange={(c) => run(() => api.updateSearch(x.id, { enabled: c === true }))} aria-label={`Enable ${x.label}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{x.label}</div>
              <div className="truncate text-xs text-muted-foreground">{x.source} · {paramsSummary(x)}</div>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${x.label}`} onClick={() => run(() => api.deleteSearch(x.id))}><Trash2 /></Button>
          </li>
        ))}
      </ul>
      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap gap-2">
          <NativeSelect size="sm" value={source} onChange={(e) => setSource(e.target.value as SearchSource)} aria-label="Source">
            <NativeSelectOption value="getonbrd">getonbrd category</NativeSelectOption>
            <NativeSelectOption value="remoteyeah">remoteyeah feed</NativeSelectOption>
            <NativeSelectOption value="workable">Workable search</NativeSelectOption>
            <NativeSelectOption value="jsearch">JSearch</NativeSelectOption>
          </NativeSelect>
          <Input className="h-7 min-w-32 flex-1" placeholder="Label (optional)" value={labelText} onChange={(e) => setLabelText(e.target.value)} />
        </div>
        {source === "jsearch" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-7 min-w-40 flex-1" placeholder='Query, e.g. "senior backend engineer"' value={query} onChange={(e) => setQuery(e.target.value)} />
            <Input className="h-7 w-16" placeholder="ar" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toLowerCase())} aria-label="Country code" />
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={remote} onCheckedChange={(c) => setRemote(c === true)} /> remote only
            </label>
          </div>
        ) : source === "workable" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-7 min-w-40 flex-1" placeholder='Words, e.g. "engineer"' value={query} onChange={(e) => setQuery(e.target.value)} />
            <Input className="h-7 w-40" placeholder="Country or city" value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Location" />
          </div>
        ) : source === "getonbrd" ? (
          <NativeSelect size="sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            {GETONBRD_CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <Input className="h-7" placeholder="https://remoteyeah.com/remote-…-jobs.xml" value={feed} onChange={(e) => setFeed(e.target.value)} />
        )}
        <Button size="sm" variant="outline" disabled={source === "jsearch" ? !query.trim() : source === "workable" ? !(query.trim() || place.trim()) : source === "remoteyeah" ? !feed.endsWith(".xml") : false} onClick={add}>
          <Plus /> Add search
        </Button>
      </div>
    </section>
  );
}
