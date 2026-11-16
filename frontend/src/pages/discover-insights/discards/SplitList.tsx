import type { Tally } from "@/api/discoveryInsights";

/** One split of a reason's discards: its top values and how many had each. */
export function SplitList<T extends string | number>({ title, values, show }: { title: string; values: Tally<T>; show?: (v: T) => string }) {
  return (
    <div className="min-w-0">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {values.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-xs">
          {values.map(([v, n]) => (
            <li key={String(v)} className="flex justify-between gap-2">
              <span className="truncate">{show ? show(v) : String(v)}</span>
              <span className="tabular-nums text-muted-foreground">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
