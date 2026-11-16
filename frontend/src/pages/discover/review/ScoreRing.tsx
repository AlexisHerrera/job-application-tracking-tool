import type { Posting } from "@/api/discovery";
import { cn } from "@/lib/utils";

const TONE = {
  match: { ring: "stroke-emerald-500", text: "text-emerald-700 dark:text-emerald-300", label: "Match" },
  maybe: { ring: "stroke-amber-500", text: "text-amber-700 dark:text-amber-300", label: "Maybe" },
  no: { ring: "stroke-rose-500", text: "text-rose-700 dark:text-rose-300", label: "No" },
};
const R = 26;
const LENGTH = 2 * Math.PI * R;

/** The AI's score as a ring, coloured by its verdict. */
export function ScoreRing({ p }: { p: Posting }) {
  const tone = p.verdict ? TONE[p.verdict] : null;
  const score = p.score ?? 0;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1" title={tone ? `AI verdict: ${tone.label}, fit ${score} out of 100` : "Not scored by the AI yet"}>
      <div className="relative size-16">
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={R} fill="none" strokeWidth="6" className="stroke-muted" />
          {tone && <circle cx="32" cy="32" r={R} fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(LENGTH * score) / 100} ${LENGTH}`} className={tone.ring} />}
        </svg>
        <span className={cn("absolute inset-0 grid place-items-center text-lg font-semibold tabular-nums", tone?.text ?? "text-muted-foreground")}>{tone ? score : "–"}</span>
      </div>
      <span className={cn("text-xs font-medium", tone?.text ?? "text-muted-foreground")}>{tone?.label ?? "Not scored"}</span>
    </div>
  );
}
