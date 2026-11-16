import type { DiscoveryRules } from "@/api/discovery";
import type { CriteriaProfile, ProfileListKey } from "@/api/discoverySettings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NumberField } from "@/pages/discover-criteria/NumberField";
import { SettingsCard } from "@/features/discovery/SettingsCard";
import { ChipField } from "./ChipField";
import { LocationCard } from "./LocationCard";
import { RuleMark } from "./RuleMark";

/** The criteria as fields, one card per topic. */
export function ProfileForm({ profile, onChange, rules, onOpenRules }: { profile: CriteriaProfile; onChange: (p: CriteriaProfile) => void; rules: DiscoveryRules; onOpenRules: () => void }) {
  const set = <K extends keyof CriteriaProfile>(key: K, value: CriteriaProfile[K]) => onChange({ ...profile, [key]: value });
  const list = (key: ProfileListKey) => ({ values: profile[key], onChange: (v: string[]) => set(key, v) });

  return (
    <div className="space-y-4">
      <SettingsCard title="Candidate" hint="Who the AI is screening for: where you live, what you've done, the languages you work in.">
        <div className="space-y-1">
          <Label htmlFor="criteria-home" className="text-xs">Lives in</Label>
          <Input id="criteria-home" className="h-8" value={profile.home} onChange={(e) => set("home", e.target.value)} placeholder="City, country" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="criteria-background" className="text-xs">Background</Label>
          <Textarea id="criteria-background" rows={8} className="text-xs" value={profile.background} onChange={(e) => set("background", e.target.value)} placeholder="Years of experience, past roles and what you built, education, languages." />
        </div>
      </SettingsCard>

      <SettingsCard title="Roles">
        <ChipField label="Roles wanted" {...list("roles")} placeholder="e.g. backend engineer" />
        <ChipField label="AI roles that are welcome too" hint="The AI is told never to mark a posting down for being about AI." {...list("ai_roles")} placeholder="e.g. forward deployed engineer" />
      </SettingsCard>

      <SettingsCard title="Seniority">
        <div className="grid gap-4 sm:grid-cols-3">
          <ChipField label="Fine" {...list("seniority_ok")} />
          <ChipField label="At most a maybe" {...list("seniority_maybe")} />
          <ChipField label="A no" {...list("seniority_no")} mark={(v) => <RuleMark value={v} words={rules.seniority_exclude} rule="Seniority words" />} />
        </div>
        <div className="max-w-56">
          <NumberField label="Most years of experience asked" value={profile.max_years} placeholder="no limit" onChange={(v) => set("max_years", v)} hint="More than this is a no." />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Stack"
        hint={
          <>
            Marked <RuleMark value="x" words={["x"]} rule="Stack words" /> when the Stack words rule also hides titles with it (AI titles excepted).{" "}
            <button type="button" className="underline underline-offset-2" onClick={onOpenRules}>Edit the rules</button>
          </>
        }
      >
        <ChipField label="What you work with" {...list("stack")} placeholder="e.g. TypeScript" />
        <ChipField label="Roles mainly in these are a no" {...list("stack_no")} placeholder="e.g. Java" mark={(v) => <RuleMark value={v} words={rules.title_exclude} rule="Stack words" />} />
      </SettingsCard>

      <LocationCard profile={profile} set={set} rules={rules} onOpenRules={onOpenRules} />

      <SettingsCard title="Salary and industry">
        <div className="max-w-56">
          <NumberField label="Minimum salary (USD a year)" value={profile.salary_min_usd} placeholder="no minimum" onChange={(v) => set("salary_min_usd", v || null)} hint="For the AI. The Rules tab's salary floor hides postings that state less." />
        </div>
        <ChipField label="Industries to put first" hint="Preferred, not required." {...list("industries")} placeholder="e.g. fintech" />
      </SettingsCard>

      <SettingsCard title="Other notes" hint="Anything the fields don't cover: which employers are fine, what scores lower. The AI reads it as written.">
        <Textarea rows={8} className="text-xs" value={profile.notes} onChange={(e) => set("notes", e.target.value)} aria-label="Other notes" />
      </SettingsCard>
    </div>
  );
}
