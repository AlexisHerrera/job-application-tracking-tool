import { OUTCOMES } from "./outcomes";
import { OutcomeSwatch } from "./OutcomeSwatch";

/** The four outcome colors, then "Waiting" (the empty track). */
export function OutcomeLegend() {
  const items = [...OUTCOMES.map((o) => ({ label: o.label, swatch: <OutcomeSwatch color={o.color} /> })), { label: "Waiting", swatch: <OutcomeSwatch track /> }];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => <span key={i.label} className="inline-flex items-center gap-1.5">{i.swatch}{i.label}</span>)}
    </div>
  );
}
