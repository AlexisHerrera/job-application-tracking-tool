import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export function SelectField({ value, options, onSave }: { value: string; options: string[]; onSave: (v: string | null) => Promise<void> }) {
  return (
    <NativeSelect size="sm" className="w-full max-w-56" value={value} onChange={(e) => onSave(e.target.value || null)}>
      {options.map((o) => <NativeSelectOption key={o} value={o}>{o || "—"}</NativeSelectOption>)}
    </NativeSelect>
  );
}
