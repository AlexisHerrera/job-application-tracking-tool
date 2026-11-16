import { label } from "@/lib/format";
import { type Facet } from "@/api/discovery";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export function FacetSelect({ value, onChange, all, options, names }: { value: string; onChange: (v: string) => void; all: string; options: Facet; names?: Record<string, string> }) {
  // Keep the chosen value listed even when no posting in this view has it.
  const opts: Facet = value && !options.some(([v]) => v === value) ? [...options, [value, 0]] : options;
  return (
    <NativeSelect size="sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={all} className={cn(value && "[&_select]:border-primary")}>
      <NativeSelectOption value="">{all}</NativeSelectOption>
      {opts.map(([v, n]) => (
        <NativeSelectOption key={v} value={v}>
          {names?.[v] ?? label(v)} ({n})
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
