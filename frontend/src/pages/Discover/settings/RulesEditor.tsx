import type { DiscoveryRules } from "@/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LIST_FIELDS } from "./constants";

function NumberField({ label: text, value, placeholder, onChange }: { label: string; value: number | null; placeholder?: string; onChange: (v: number | null) => void }) {
  const parse = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v)) || 0));
  return (
    <div className="space-y-1">
      <Label className="text-xs">{text}</Label>
      <Input inputMode="numeric" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(parse(e.target.value))} />
    </div>
  );
}

/** The number rules and the word / company lists (one per line, as typed). */
export function RulesEditor({
  rules,
  onRulesChange,
  lists,
  onListsChange,
}: {
  rules: DiscoveryRules;
  onRulesChange: (rules: DiscoveryRules) => void;
  lists: Record<string, string>;
  onListsChange: (lists: Record<string, string>) => void;
}) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium">Rules</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumberField label="Max age (days)" value={rules.max_age_days} onChange={(v) => onRulesChange({ ...rules, max_age_days: v ?? 21 })} />
        <NumberField label="Salary floor (USD/yr)" value={rules.salary_floor_usd} placeholder="none" onChange={(v) => onRulesChange({ ...rules, salary_floor_usd: v || null })} />
        <NumberField label="JSearch cap / month" value={rules.jsearch_monthly_cap} onChange={(v) => onRulesChange({ ...rules, jsearch_monthly_cap: v ?? 190 })} />
      </div>
      {LIST_FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`rule-${f.key}`}>{f.label}</Label>
          <p className="text-xs text-muted-foreground">{f.hint}</p>
          <Textarea id={`rule-${f.key}`} rows={4} value={lists[f.key] ?? ""} onChange={(e) => onListsChange({ ...lists, [f.key]: e.target.value })} className="text-xs" />
        </div>
      ))}
    </section>
  );
}
