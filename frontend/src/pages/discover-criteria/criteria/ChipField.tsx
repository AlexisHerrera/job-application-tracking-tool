import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { ChipListInput } from "@/pages/discover-criteria/ChipListInput";

/** A labelled chip list inside a criteria card. */
export function ChipField({ label, hint, values, onChange, placeholder, mark }: { label: string; hint?: ReactNode; values: string[]; onChange: (v: string[]) => void; placeholder?: string; mark?: (v: string) => ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-xs">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <ChipListInput label={label} values={values} onChange={onChange} placeholder={placeholder} mark={mark} />
    </div>
  );
}
