/** A day's readout: every series, value first, keyed by a short line of its color. */
export function DayTooltip({ title, rows, total, left }: { title: string; rows: { label: string; color: string; value: number }[]; total: number; left: number }) {
  return (
    <div className="pointer-events-none absolute top-1 z-10 w-44 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md" style={{ left: Math.max(0, left) }}>
      <div className="mb-1 text-muted-foreground">{title}</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="w-10 font-semibold tabular-nums">{r.value.toLocaleString()}</span>
            <span className="text-muted-foreground">{r.label}</span>
          </li>
        ))}
        {rows.length > 1 && (
          <li className="flex items-center gap-2 border-t pt-0.5">
            <span aria-hidden className="w-3 shrink-0" />
            <span className="w-10 font-semibold tabular-nums">{total.toLocaleString()}</span>
            <span className="text-muted-foreground">in all</span>
          </li>
        )}
      </ul>
    </div>
  );
}
