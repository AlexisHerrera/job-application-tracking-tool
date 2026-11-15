import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, MessagesSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtDate, label, type Insights, type InterviewOutcome, type TypeRow } from "../api";
import { TypePicker } from "@/features/interviews/TypePicker";
import { interviewName } from "@/lib/interviews";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { useRefresh } from "../lib/refresh";

// Counts are small, so rates read "x of n" and say how many are still waiting. Colors reuse the
// flow chart's tokens (index.css, --flow-*): indigo for progress, rose for rejected, slate for no
// answer. "Waiting" is the empty track, never a fill.

const OUTCOMES: { key: Exclude<InterviewOutcome, "waiting">; label: string; color: string }[] = [
  { key: "advanced", label: "Next round", color: "var(--flow-interviewing)" },
  { key: "rejected", label: "Rejected", color: "var(--flow-rejected)" },
  { key: "no_answer", label: "No answer", color: "var(--flow-ghosted)" },
  { key: "withdrew", label: "Withdrew", color: "var(--flow-withdrawn)" },
];
const OUTCOME = Object.fromEntries(OUTCOMES.map((o) => [o.key, o])) as Record<string, (typeof OUTCOMES)[number]>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const typeLabel = (t: string) => (t === "not_set" ? "Type not set" : label(t).replace(/^./, (c) => c.toUpperCase()));

function Swatch({ color, track }: { color?: string; track?: boolean }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", track && "bg-muted ring-1 ring-border ring-inset")}
      style={track ? undefined : { background: color }}
    />
  );
}

function Legend({ items }: { items: { label: string; swatch: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => <span key={i.label} className="inline-flex items-center gap-1.5">{i.swatch}{i.label}</span>)}
    </div>
  );
}

/** A horizontal track with segments side by side, 2px apart. Widths are shares of the track. */
function Track({ segments }: { segments: { share: number; style: CSSProperties; title: string }[] }) {
  return (
    <div className="flex h-3 flex-1 gap-0.5 overflow-hidden rounded bg-muted">
      {segments.filter((s) => s.share > 0).map((s, i) => (
        <div key={i} title={s.title} className="h-full first:rounded-l last:rounded-r" style={{ width: `${s.share * 100}%`, ...s.style }} />
      ))}
    </div>
  );
}

/** What came after each interview, by type. A row opens its interviews, where the type can be fixed. */
export function InterviewTypesCard({ data }: { data: Insights }) {
  const rows = data.interview_types;
  const max = Math.max(1, ...rows.map((r) => r.done));
  const [open, setOpen] = useState<Set<string>>(() => new Set(["not_set"]));
  const toggle = (t: string) => setOpen((s) => new Set(s.has(t) ? [...s].filter((x) => x !== t) : [...s, t]));
  const rated = rows.some((r) => r.rated > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessagesSquare className="size-4 text-muted-foreground" /> How interviews went</CardTitle>
        <CardDescription>What came after each interview, by type. Open a type to see its interviews and fix their types.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No interviews yet.</p>
        ) : (
          <>
            <Legend items={[...OUTCOMES.map((o) => ({ label: o.label, swatch: <Swatch color={o.color} /> })), { label: "Waiting", swatch: <Swatch track /> }]} />
            <div className="divide-y">
              {rows.map((r) => <TypeRowView key={r.type} row={r} scale={r.done / max} open={open.has(r.type)} onToggle={() => toggle(r.type)} />)}
            </div>
            {!rated && <p className="text-xs text-muted-foreground">Rate yourself in an interview's notes to see how it lines up with what came after.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TypeRowView({ row, scale, open, onToggle }: { row: TypeRow; scale: number; open: boolean; onToggle: () => void }) {
  const { bump } = useRefresh();
  const openEditor = useOpenEditor();
  const decided = row.done - row.waiting;
  const rating = [
    row.rating_advanced !== null && `${row.rating_advanced} when it went on`,
    row.rating_not !== null && `${row.rating_not} when it didn't`,
  ].filter(Boolean);
  return (
    <div className="py-2 text-sm">
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-[1rem_8rem_1fr_auto] items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className={cn("truncate", row.type === "not_set" && "text-muted-foreground italic")}>{typeLabel(row.type)}</span>
        <div className="flex" style={{ width: `${Math.max(scale, 0.08) * 100}%` }}>
          <Track segments={OUTCOMES.map((o) => ({ share: row[o.key] / row.done, style: { background: o.color }, title: `${row[o.key]} ${o.label.toLowerCase()}` }))} />
        </div>
        <span className="w-36 text-right text-xs tabular-nums">
          <span className="font-medium">{decided ? `${row.advanced} of ${decided} went on` : "waiting on all"}</span>
          {decided > 0 && row.waiting > 0 && <span className="text-muted-foreground"> · {row.waiting} waiting</span>}
          <span className="block text-muted-foreground">{plural(row.done, "interview")}</span>
        </span>
      </button>
      {rating.length > 0 && <div className="mt-0.5 pl-[10.5rem] text-xs text-muted-foreground">Your rating: {rating.join(" · ")}</div>}
      {open && (
        <ul className="mt-2 ml-6 space-y-1 border-l pl-3">
          {row.interviews.map((iv) => {
            const o = iv.outcome === "waiting" ? null : OUTCOME[iv.outcome];
            return (
              <li key={iv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" onClick={() => openEditor("interview", iv.id)} className="group min-w-0 flex-1 text-left">
                  <span className="block truncate"><span className="font-medium group-hover:underline">{iv.company}</span> · {interviewName(iv)}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {fmtDate(iv.at)} · {o ? <><Swatch color={o.color} />{o.label.toLowerCase()}</> : <><Swatch track />waiting</>}
                    {iv.rating !== null && <> · rated {iv.rating}</>}
                  </span>
                </button>
                <TypePicker id={iv.id} value={iv.interview_type} guessed={iv.guessed} onSaved={bump} className="w-40" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
