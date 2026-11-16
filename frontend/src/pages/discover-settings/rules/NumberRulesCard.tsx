import type { DiscoveryRules, DiscoveryState } from "@/api/discovery";
import type { RuleHits } from "@/api/discoverySettings";
import { NumberField } from "@/pages/discover-settings/NumberField";
import { SettingsCard } from "@/pages/discover-settings/SettingsCard";

/** Max age, salary floor and (when a JSearch search is on) the monthly JSearch cap. */
export function NumberRulesCard({ rules, onChange, state, hits }: { rules: DiscoveryRules; onChange: (r: DiscoveryRules) => void; state: DiscoveryState; hits: RuleHits | null }) {
  const jsearch = state.searches.some((x) => x.source === "jsearch" && x.enabled);
  const hid = (reason: string) => (hits ? ` Hid ${(hits.reasons[reason] ?? 0).toLocaleString()}.` : "");
  return (
    <SettingsCard title="Age and salary">
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField label="Max age (days)" value={rules.max_age_days} onChange={(v) => onChange({ ...rules, max_age_days: v || 21 })} hint={`Not for company boards and Workable, which list only open jobs.${hid("old")}`} />
        <NumberField label="Salary floor (USD a year)" value={rules.salary_floor_usd} placeholder="none" onChange={(v) => onChange({ ...rules, salary_floor_usd: v || null })} hint={`Hides postings that state less.${hid("salary")}`} />
        {jsearch && (
          <NumberField label="JSearch requests a month" value={rules.jsearch_monthly_cap} onChange={(v) => onChange({ ...rules, jsearch_monthly_cap: v ?? 190 })} hint={`${state.jsearch_used_this_month} used this month; 200 are free.`} />
        )}
      </div>
    </SettingsCard>
  );
}
