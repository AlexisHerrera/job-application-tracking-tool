import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { DiscoveryRules, DiscoveryState } from "@/api/discovery";
import { errorText } from "@/lib/errors";
import { useAsync } from "@/lib/useAsync";
import { SaveBar } from "@/pages/discover-criteria/SaveBar";
import { LIST_FIELDS } from "./constants";
import { HiddenSummary } from "./HiddenSummary";
import { NumberRulesCard } from "./NumberRulesCard";
import { RuleListCard } from "./RuleListCard";

function savedMessage(r: { hidden: number; restored: number } | null): string {
  if (!r || (r.hidden === 0 && r.restored === 0)) return "Saved. No stored posting changed.";
  const parts = [r.hidden && `${r.hidden} more hidden`, r.restored && `${r.restored} back in the list`].filter(Boolean);
  return `Saved: ${parts.join(", ")}.${r.restored ? " The ones back without a score wait for “Score pending”." : ""}`;
}

/** The rules that hide postings before any AI call, with what each one hid. */
export function RulesTab({ state, onSaved }: { state: DiscoveryState; onSaved: (s: DiscoveryState) => void }) {
  const [draft, setDraft] = useState<DiscoveryRules>(state.rules);
  const [saving, setSaving] = useState(false);
  const hits = useAsync(api.ruleHits);
  const changed = JSON.stringify(draft) !== JSON.stringify(state.rules);

  async function save() {
    setSaving(true);
    try {
      const saved = await api.saveDiscoverySettings({ rules: draft });
      setDraft(saved.rules);
      onSaved(saved);
      toast.success(savedMessage(saved.reapplied));
      void hits.reload();
    } catch (e) {
      toast.error(errorText(e));
    }
    setSaving(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        <NumberRulesCard rules={draft} onChange={setDraft} hits={hits.data} />
        {LIST_FIELDS.map((f) => (
          <RuleListCard
            key={f.key}
            label={f.label}
            hint={f.hint}
            placeholder={f.placeholder}
            values={draft[f.key]}
            onChange={(v) => setDraft({ ...draft, [f.key]: v })}
            hits={hits.data?.lists[f.key]}
            added={f.key === "blocked" ? state.blocked_added : undefined}
          />
        ))}
      </div>
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <SaveBar
          label="Save rules"
          changed={changed}
          canSave={changed}
          saving={saving}
          onSave={save}
          onDiscard={() => setDraft(state.rules)}
          note="Saving applies the rules to the stored postings too: new ones a rule now catches are hidden, and hidden ones whose rule you removed come back."
        />
        <HiddenSummary hits={hits.data} />
      </aside>
    </div>
  );
}
