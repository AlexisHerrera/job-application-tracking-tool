import type { DiscoveryRules } from "@/api/discovery";
import type { RuleHits } from "@/api/discoverySettings";
import { NumberField } from "@/pages/discover-criteria/NumberField";
import { SettingsCard } from "@/features/discovery/SettingsCard";

/** Max age and salary floor. */
export function NumberRulesCard({ rules, onChange, hits }: { rules: DiscoveryRules; onChange: (r: DiscoveryRules) => void; hits: RuleHits | null }) {
  const hid = (reason: string) => (hits ? ` Hid ${(hits.reasons[reason] ?? 0).toLocaleString()}.` : "");
  return (
    <SettingsCard title="Age and salary">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label="Max age (days)" value={rules.max_age_days} onChange={(v) => onChange({ ...rules, max_age_days: v || 21 })} hint={`Not for company boards and Workable, which list only open jobs.${hid("old")}`} />
        <NumberField label="Salary floor (USD a year)" value={rules.salary_floor_usd} placeholder="none" onChange={(v) => onChange({ ...rules, salary_floor_usd: v || null })} hint={`Hides postings that state less.${hid("salary")}`} />
      </div>
    </SettingsCard>
  );
}
