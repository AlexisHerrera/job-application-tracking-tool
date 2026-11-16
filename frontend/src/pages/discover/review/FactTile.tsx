import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FactTone = "good" | "bad" | "warn" | "info" | "plain";

const TONES: Record<FactTone, string> = {
  good: "border-emerald-500/25 bg-emerald-500/10 [&_svg]:text-emerald-600 dark:[&_svg]:text-emerald-400",
  bad: "border-rose-500/25 bg-rose-500/10 [&_svg]:text-rose-600 dark:[&_svg]:text-rose-400",
  warn: "border-amber-500/25 bg-amber-500/10 [&_svg]:text-amber-600 dark:[&_svg]:text-amber-400",
  info: "border-primary/20 bg-primary/5 [&_svg]:text-primary",
  plain: "bg-muted/40 [&_svg]:text-muted-foreground",
};

/** One fact about the posting: icon, what it is, the value, and an optional second line. */
export function FactTile({ icon, label, value, detail, tone = "plain" }: { icon: ReactNode; label: string; value: ReactNode; detail?: ReactNode; tone?: FactTone }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border p-3 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0", TONES[tone])}>
      {icon}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium break-words">{value}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}
