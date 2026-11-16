import { fmtDate } from "@/lib/format";
import { type FieldChange, type PasteOption, type PasteRecord } from "@/api/applications";

export type Selection = { option: number; fields: Set<string>; stage: boolean; skip: boolean; role: string; company: string };

export const NO_COMPANY = "Company not named";

export const KIND_TEXT: Record<FieldChange["kind"], string> = {
  fill: "fills empty",
  append: "adds to",
  change: "⚠ will modify",
};

export const KIND_CLASS: Record<FieldChange["kind"], string> = {
  fill: "text-emerald-700 dark:text-emerald-400",
  append: "text-blue-700 dark:text-blue-400",
  change: "text-amber-700 dark:text-amber-400",
};

export function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "process_steps" && Array.isArray(value)) return value.map((st: { name: string }) => st.name).join(" → ");
  if (Array.isArray(value)) return value.join(", ");
  if (field === "applied_at" && typeof value === "string") return fmtDate(value);
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value);
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

export function defaults(option: PasteOption): Pick<Selection, "fields" | "stage"> {
  return {
    fields: new Set(option.changes.filter((c) => c.kind !== "change").map((c) => c.field)),
    stage: option.stage_change?.kind === "fill",
  };
}

export type PasteSummaryCounts = { creates: number; updates: number; fills: number; appends: number; overwrites: string[] };

/** What applying the current selection will do, with every overwrite spelled out. */
export function summarize(records: PasteRecord[], sel: Selection[]): PasteSummaryCounts {
  let creates = 0, updates = 0, fills = 0, appends = 0;
  const overwrites: string[] = [];
  records.forEach((rec, i) => {
    const s = sel[i];
    if (!s || s.skip) return;
    const opt = rec.options[s.option];
    const picked = opt.changes.filter((c) => s.fields.has(c.field));
    if (opt.application_id === null) creates++;
    else if (picked.length || (s.stage && opt.stage_change)) updates++;
    for (const c of picked) {
      if (c.kind === "fill") fills++;
      else if (c.kind === "append") appends++;
      else overwrites.push(`${rec.company ?? NO_COMPANY}: ${c.label} "${show(c.field, c.current)}" → "${show(c.field, c.proposed)}"`);
    }
    if (s.stage && opt.stage_change?.kind === "change") {
      overwrites.push(`${rec.company ?? NO_COMPANY}: stage ${opt.stage_change.current} → ${opt.stage_change.proposed}`);
    }
  });
  return { creates, updates, fills, appends, overwrites };
}
