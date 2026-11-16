import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export function SourceSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <NativeSelect size="sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Source" className={cn(value && "[&_select]:border-primary")}>
      <NativeSelectOption value="">All sources</NativeSelectOption>
      <NativeSelectOption value="remoteyeah">remoteyeah</NativeSelectOption>
      <NativeSelectOption value="getonbrd">getonbrd</NativeSelectOption>
      <NativeSelectOption value="workable">Workable</NativeSelectOption>
      <NativeSelectOption value="ashby">Company boards · Ashby</NativeSelectOption>
      <NativeSelectOption value="greenhouse">Company boards · Greenhouse</NativeSelectOption>
      <NativeSelectOption value="lever">Company boards · Lever</NativeSelectOption>
      <NativeSelectOption value="jsearch">JSearch</NativeSelectOption>
    </NativeSelect>
  );
}
