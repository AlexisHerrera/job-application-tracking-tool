import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { type TypeRow } from "@/api/dashboard";
import { TypePicker } from "@/features/interviews/TypePicker";
import { interviewName } from "@/lib/interviews";
import { useOpenEditor } from "@/lib/useOpenEditor";
import { useRefresh } from "@/lib/refresh";
import { OUTCOME, OUTCOMES, plural, typeLabel } from "./outcomes";
import { OutcomeSwatch } from "./OutcomeSwatch";
import { OutcomeTrack } from "./OutcomeTrack";

export function InterviewTypeRow({ row, scale, open, onToggle }: { row: TypeRow; scale: number; open: boolean; onToggle: () => void }) {
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
          <OutcomeTrack segments={OUTCOMES.map((o) => ({ share: row[o.key] / row.done, style: { background: o.color }, title: `${row[o.key]} ${o.label.toLowerCase()}` }))} />
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
                    {fmtDate(iv.at)} · {o ? <><OutcomeSwatch color={o.color} />{o.label.toLowerCase()}</> : <><OutcomeSwatch track />waiting</>}
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
