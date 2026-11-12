// Job discovery (plan §20): new openings from the saved searches, scored by the LLM against the
// criteria. Everything in a posting comes from the web: rendered as text, links only if http(s).
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, ExternalLink, Play, Plus, Settings2, Sparkles, Star, Telescope, ThumbsDown, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
  type DiscoveryRules,
  type DiscoveryRun,
  type DiscoverySearch,
  type DiscoveryState,
  type Posting,
  type PostingStatus,
} from "../api";
import { Empty, Loading, PageHeader } from "../components/common";
import { useAsync } from "../useAsync";

type View = "match" | "maybe" | "no" | "unscored" | "all" | "hidden";
type StatusFilter = "open" | "interested" | "applied" | "dismissed" | "any";

const VIEWS: { value: View; label: string }[] = [
  { value: "match", label: "Matches" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
  { value: "unscored", label: "Not scored" },
  { value: "all", label: "All" },
  { value: "hidden", label: "Hidden" },
];

function queryFor(view: View, status: StatusFilter, source: string): Record<string, string> {
  const q: Record<string, string> = {};
  if (view === "hidden") q.hidden = "true";
  else if (view !== "all") q.verdict = view;
  if (status === "open") q.status = "new,interested";
  else if (status !== "any") q.status = status;
  if (source) q.source = source;
  return q;
}

const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

export default function Discover() {
  const [view, setView] = useState<View>("match");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [source, setSource] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const state = useAsync(api.discoverySettings);
  const list = useAsync(() => api.postings(queryFor(view, status, source)), [view, status, source]);

  const reloadAll = () => {
    void state.reload();
    void list.reload();
  };
  const s = state.data;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Discover"
        description="New openings from your saved searches, scored against your criteria."
        actions={
          s && (
            <>
              <RunButton state={s} onDone={reloadAll} />
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 /> Criteria & searches
              </Button>
            </>
          )
        }
      />

      {s && <LastRun run={s.last_run} used={s.jsearch_used_this_month} cap={s.rules.jsearch_monthly_cap} />}

      {s && s.searches.length === 0 ? (
        <Empty icon={<Telescope className="size-8" />}>
          <p>No saved searches yet.</p>
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api.seedDiscovery();
                toast.success("Loaded the default searches and criteria. Review them, then run.");
                reloadAll();
                setSettingsOpen(true);
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          >
            Load the default searches
          </Button>
        </Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Verdict">
              {VIEWS.map((v) => (
                <ToggleGroupItem key={v.value} value={v.value}>
                  {v.label}
                  {v.value === "hidden" && list.data ? ` · ${list.data.counts.hidden}` : ""}
                  {v.value === "unscored" && list.data && list.data.counts.unscored ? ` · ${list.data.counts.unscored}` : ""}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <NativeSelect size="sm" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status">
              <NativeSelectOption value="open">To look at</NativeSelectOption>
              <NativeSelectOption value="interested">Interested</NativeSelectOption>
              <NativeSelectOption value="applied">Applied</NativeSelectOption>
              <NativeSelectOption value="dismissed">Not for me</NativeSelectOption>
              <NativeSelectOption value="any">Any status</NativeSelectOption>
            </NativeSelect>
            <NativeSelect size="sm" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
              <NativeSelectOption value="">All sources</NativeSelectOption>
              <NativeSelectOption value="jsearch">JSearch</NativeSelectOption>
              <NativeSelectOption value="remoteyeah">remoteyeah</NativeSelectOption>
            </NativeSelect>
          </div>

          {!list.data ? (
            <Loading error={list.error} loading={list.loading} />
          ) : list.data.postings.length === 0 ? (
            <Empty icon={<Telescope className="size-8" />}>
              {list.data.counts.total === 0 ? "Nothing collected yet. Run the searches to fill this page." : "Nothing here with these filters."}
            </Empty>
          ) : (
            <div className="space-y-3">
              {list.data.postings.map((p) => (
                <PostingCard key={p.id} p={p} onChange={() => void list.reload()} />
              ))}
            </div>
          )}
        </>
      )}

      {s && <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} state={s} onSaved={reloadAll} />}
    </div>
  );
}

function RunButton({ state, onDone }: { state: DiscoveryState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!state.can_run) return null;
  const enabled = state.searches.filter((x) => x.enabled);
  const jsearch = state.jsearch_configured ? enabled.filter((x) => x.source === "jsearch").length : 0;
  async function run() {
    setBusy(true);
    const id = toast.loading("Collecting new openings…");
    try {
      const r = await api.runDiscovery();
      const msg = `${r.new} new · ${r.dropped} hidden · ${r.llm_calls} scored`;
      if (r.errors) toast.warning(`${msg}. ${r.notes.join(" · ")}`, { id });
      else toast.success(msg, { id });
      onDone();
    } catch (e) {
      toast.error(errorText(e), { id });
    }
    setBusy(false);
  }
  return (
    <Button size="sm" disabled={busy || enabled.length === 0} onClick={run} title={`Uses about ${jsearch} JSearch request${jsearch === 1 ? "" : "s"}, plus AI scoring of new postings`}>
      <Play className={cn(busy && "animate-pulse")} /> {busy ? "Running…" : "Run now"}
    </Button>
  );
}

function LastRun({ run, used, cap }: { run: DiscoveryRun | null; used: number; cap: number }) {
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
      {" · "}JSearch this month: {used} / {cap}
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
  old: "too old",
  salary: "below the salary floor",
  duplicate: "duplicate",
};

function PostingCard({ p, onChange }: { p: Posting; onChange: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const url = safeUrl(p.url);
  const salary = salaryOf(p);
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
        </div>

        {p.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {p.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        {p.stack_overlap.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {p.stack_overlap.map((t) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>)}
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
  { key: "agencies", label: "Agencies & talent marketplaces", hint: "Dropped. One company per line." },
  { key: "consultancies", label: "Consultancies", hint: "Hidden. One company per line." },
  { key: "seniority_exclude", label: "Seniority words", hint: "A title with one of these is hidden (junior, intern…)." },
  { key: "title_exclude", label: "Stack / role words", hint: "Hidden unless the title is about AI. Whole words: \"java\" doesn't hit JavaScript." },
  { key: "location_allow", label: "remoteyeah locations", hint: "A remoteyeah job is hidden unless its location mentions one of these (empty = kept)." },
];

function SettingsSheet({ open, onOpenChange, state, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; state: DiscoveryState; onSaved: () => void }) {
  const [criteria, setCriteria] = useState(state.criteria);
  const [rules, setRules] = useState<DiscoveryRules>(state.rules);
  const [lists, setLists] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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

  async function rescore() {
    const id = toast.loading("Collecting and re-scoring…");
    try {
      const r = await api.runDiscovery(true);
      toast.success(`${r.new} new · ${r.llm_calls} scored`, { id });
      onSaved();
    } catch (e) {
      toast.error(errorText(e), { id });
    }
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

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save criteria & rules"}</Button>
            {state.can_run && (
              <Button size="sm" variant="outline" onClick={rescore} title="Runs the searches too (JSearch requests), then scores the recent postings again (paid AI calls)">
                Run and re-score recent
              </Button>
            )}
          </div>

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

function paramsSummary(x: DiscoverySearch): string {
  if (x.source === "remoteyeah") return String(x.params.feed ?? "").replace("https://remoteyeah.com/", "");
  const parts = [`"${x.params.query}"`];
  if (x.params.country) parts.push(String(x.params.country).toUpperCase());
  if (x.params.work_from_home) parts.push("remote only");
  return parts.join(" · ");
}

function Searches({ searches, jsearchConfigured, onChange }: { searches: DiscoverySearch[]; jsearchConfigured: boolean; onChange: () => void }) {
  const [source, setSource] = useState<"jsearch" | "remoteyeah">("jsearch");
  const [labelText, setLabelText] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("ar");
  const [remote, setRemote] = useState(false);
  const [feed, setFeed] = useState("https://remoteyeah.com/");
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
    const params: DiscoverySearch["params"] = source === "jsearch" ? { query, country } : { feed };
    if (source === "jsearch" && remote) params.work_from_home = true;
    await run(async () => {
      await api.addSearch({ source, label: labelText || (source === "jsearch" ? `${country.toUpperCase()} · ${query}` : feed.split("/").pop() ?? "feed"), params, enabled: true });
      setLabelText("");
      setQuery("");
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Searches</h3>
        <p className="text-xs text-muted-foreground">
          {enabledJsearch} JSearch search{enabledJsearch === 1 ? "" : "es"} on: about {enabledJsearch * 30} of the free 200 requests a month at one run a day. remoteyeah feeds are free.
          {!jsearchConfigured && " JSEARCH_API_KEY isn't set, so JSearch searches are skipped."}
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
          <NativeSelect size="sm" value={source} onChange={(e) => setSource(e.target.value as "jsearch" | "remoteyeah")} aria-label="Source">
            <NativeSelectOption value="jsearch">JSearch</NativeSelectOption>
            <NativeSelectOption value="remoteyeah">remoteyeah feed</NativeSelectOption>
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
        ) : (
          <Input className="h-7" placeholder="https://remoteyeah.com/remote-…-jobs.xml" value={feed} onChange={(e) => setFeed(e.target.value)} />
        )}
        <Button size="sm" variant="outline" disabled={source === "jsearch" ? !query.trim() : !feed.endsWith(".xml")} onClick={add}>
          <Plus /> Add search
        </Button>
      </div>
    </section>
  );
}
