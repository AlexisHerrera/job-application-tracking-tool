import { ChevronRight } from "lucide-react";
import type { DiscardReasonRow } from "@/api/discoveryInsights";
import { DISCARD_REASONS } from "@/features/discovery/discardReasons";
import { cn } from "@/lib/utils";
import { HintList } from "./HintList";
import { ReasonDetails } from "./ReasonDetails";

const META = Object.fromEntries(DISCARD_REASONS.map((r) => [r.value, r]));

/** One reason: how many, a bar on the card's scale, its hints, and (opened) where they came from. */
export function ReasonRow({ row, scale, open, onToggle }: { row: DiscardReasonRow; scale: number; open: boolean; onToggle: () => void }) {
  const meta = META[row.reason];
  const Icon = meta?.icon;
  return (
    <div className="py-3 text-sm">
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-[1rem_minmax(0,11rem)_1fr_2.5rem] items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="flex min-w-0 items-center gap-1.5">
          {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate font-medium" title={meta?.hint}>{meta?.label ?? row.reason}</span>
        </span>
        <span className="h-2 rounded-r-[4px] bg-muted">
          <span className="block h-full rounded-r-[4px]" style={{ width: `${Math.max(scale, 0.02) * 100}%`, background: "var(--insight-queue)" }} />
        </span>
        <span className="text-right font-semibold tabular-nums">{row.count}</span>
      </button>
      <div className="mt-1.5 pl-6">
        {row.hints.length > 0 ? (
          <HintList hints={row.hints} />
        ) : (
          <p className="text-xs text-muted-foreground">{row.count === 1 ? "One so far: nothing to point at yet." : "Nothing they share points at one change yet."}</p>
        )}
        {open && <ReasonDetails row={row} />}
      </div>
    </div>
  );
}
