import type { CSSProperties } from "react";

/** A horizontal track with segments side by side, 2px apart. Widths are shares of the track. */
export function OutcomeTrack({ segments }: { segments: { share: number; style: CSSProperties; title: string }[] }) {
  return (
    <div className="flex h-3 flex-1 gap-0.5 overflow-hidden rounded bg-muted">
      {segments.filter((s) => s.share > 0).map((s, i) => (
        <div key={i} title={s.title} className="h-full first:rounded-l last:rounded-r" style={{ width: `${s.share * 100}%`, ...s.style }} />
      ))}
    </div>
  );
}
