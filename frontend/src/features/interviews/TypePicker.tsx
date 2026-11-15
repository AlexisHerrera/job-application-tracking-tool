import { useState } from "react";
import { toast } from "sonner";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errorText, label } from "@/api";
import { INTERVIEW_TYPES } from "@/lib/interviews";

/** An interview's type, saved as soon as it changes. A guess from the title fills the empty option. */
export function TypePicker({ id, value, guessed, onSaved, className }: { id: string; value: string | null; guessed?: string | null; onSaved?: (type: string | null) => void; className?: string }) {
  const [v, setV] = useState(value ?? "");
  async function change(next: string) {
    const before = v;
    setV(next);
    try {
      await api.updateInterview(id, { interview_type: next || null });
      onSaved?.(next || null);
    } catch (e) {
      setV(before);
      toast.error(errorText(e));
    }
  }
  return (
    <NativeSelect size="sm" aria-label="Interview type" value={v} onChange={(e) => void change(e.target.value)} className={className}>
      <NativeSelectOption value="">{guessed ? `${label(guessed)} (guessed)` : "Type not set"}</NativeSelectOption>
      {INTERVIEW_TYPES.map((t) => <NativeSelectOption key={t} value={t}>{label(t)}</NativeSelectOption>)}
    </NativeSelect>
  );
}
