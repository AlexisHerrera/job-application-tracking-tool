import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { DiscoveryState } from "@/api/discovery";
import { errorText } from "@/lib/errors";
import { SaveBar } from "@/pages/discover-settings/SaveBar";
import { CriteriaPreview } from "./CriteriaPreview";
import { OldCriteriaBanner } from "./OldCriteriaBanner";
import { ProfileForm } from "./ProfileForm";
import { RescoreCard } from "./RescoreCard";
import { useCriteriaPreview } from "./useCriteriaPreview";

/** What you're looking for, as fields; the AI reads the text they render to. */
export function CriteriaTab({ state, onSaved, onReload, onOpenRules }: { state: DiscoveryState; onSaved: (s: DiscoveryState) => void; onReload: () => void; onOpenRules: () => void }) {
  const [draft, setDraft] = useState(state.profile);
  const [saving, setSaving] = useState(false);
  const { preview, error } = useCriteriaPreview(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(state.profile);
  const tooLong = preview ? preview.chars > preview.limit : false;

  async function save() {
    setSaving(true);
    try {
      const saved = await api.saveDiscoverySettings({ profile: draft });
      setDraft(saved.profile);
      onSaved(saved);
      toast.success("Saved. New postings are scored with it; re-score to apply it to recent ones.");
    } catch (e) {
      toast.error(errorText(e));
    }
    setSaving(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-4">
        {!state.profile_saved && <OldCriteriaBanner />}
        <ProfileForm profile={draft} onChange={setDraft} rules={state.rules} onOpenRules={onOpenRules} />
      </div>
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <SaveBar
          label="Save criteria"
          changed={changed}
          canSave={(changed || !state.profile_saved) && !tooLong}
          saving={saving}
          onSave={save}
          onDiscard={() => setDraft(state.profile)}
          status={state.profile_saved ? undefined : "Not saved as fields yet"}
        />
        <CriteriaPreview preview={preview} error={error} />
        <RescoreCard state={state} unsaved={changed} onDone={onReload} />
      </aside>
    </div>
  );
}
