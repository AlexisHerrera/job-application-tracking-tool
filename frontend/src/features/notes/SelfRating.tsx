import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** "How it went": five stars; clicking the current one clears it. */
export function SelfRating({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">How it went</span>
      <div className="flex gap-0.5" role="radiogroup" aria-label="Self-rating">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            aria-label={`${v} of 5`}
            onClick={() => onChange(value === v ? null : v)}
            className="rounded p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Star className={cn("size-5 transition-colors", value && v <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400")} />
          </button>
        ))}
      </div>
    </div>
  );
}
