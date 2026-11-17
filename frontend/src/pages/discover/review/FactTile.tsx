import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FactTone = "good" | "bad" | "warn" | "info" | "plain";

// The tone shows on the icon and the second line only: the tiles themselves stay neutral.
const TONES: Record<FactTone, string> = {
  good: "[&_svg]:text-good [&_[data-detail]]:text-good",
  bad: "[&_svg]:text-bad [&_[data-detail]]:text-bad",
  warn: "[&_svg]:text-warn [&_[data-detail]]:text-warn",
  info: "[&_svg]:text-foreground",
  plain: "[&_svg]:text-muted-foreground",
};

/** One fact about the posting: icon, what it is, the value, and an optional second line. */
export function FactTile({ icon, label, value, detail, tone = "plain" }: { icon: ReactNode; label: string; value: ReactNode; detail?: ReactNode; tone?: FactTone }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg bg-muted/50 p-3 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0", TONES[tone])}>
      {icon}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium break-words">{value}</div>
        {detail && <div data-detail className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}
