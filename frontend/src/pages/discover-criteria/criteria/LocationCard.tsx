import type { DiscoveryRules } from "@/api/discovery";
import type { CriteriaProfile } from "@/api/discoverySettings";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SettingsCard } from "@/features/discovery/SettingsCard";
import { ChipField } from "./ChipField";

/** Where you can be hired: the AI's main check. The Locations rule acts before it. */
export function LocationCard({
  profile,
  set,
  rules,
  onOpenRules,
}: {
  profile: CriteriaProfile;
  set: <K extends keyof CriteriaProfile>(key: K, value: CriteriaProfile[K]) => void;
  rules: DiscoveryRules;
  onOpenRules: () => void;
}) {
  const city = profile.home.split(",")[0].trim() || "your city";
  return (
    <SettingsCard title="Location" hint={`The most important check: can they hire someone living in ${profile.home || "your city"}? Remote, hybrid or onsite in the ${city} area always counts as yes.`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <ChipField label="Yes: hires in" values={profile.location_yes} onChange={(v) => set("location_yes", v)} placeholder="e.g. LATAM" />
        <ChipField label="Maybe: open to" hint="When not clearly open to the yes places." values={profile.location_maybe} onChange={(v) => set("location_maybe", v)} placeholder="e.g. Brazil" />
        <ChipField label="No" values={profile.location_no} onChange={(v) => set("location_no", v)} placeholder="e.g. US-only" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="criteria-location-notes" className="text-xs">More on location</Label>
        <Textarea id="criteria-location-notes" rows={4} className="text-xs" value={profile.location_notes} onChange={(e) => set("location_notes", e.target.value)} placeholder="One point per line: contract types, currencies, signals of a US-only role…" />
      </div>
      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Before the AI, the Locations rule hides a posting whose location names none of its {rules.location_allow.length} places ({rules.location_allow.slice(0, 6).join(", ")}
        {rules.location_allow.length > 6 ? "…" : ""}); no location is kept.{" "}
        <button type="button" className="underline underline-offset-2" onClick={onOpenRules}>Edit the rule</button>
      </p>
    </SettingsCard>
  );
}
