import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WINDOWS } from "./constants";

/** The window every number on the page covers: the last 7, 14, 30 or 90 days, today included. */
export function WindowPicker({ value, onChange }: { value: number; onChange: (days: number) => void }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={String(value)} onValueChange={(v) => v && onChange(Number(v))} aria-label="Window">
      {WINDOWS.map((d) => <ToggleGroupItem key={d} value={String(d)}>Last {d} days</ToggleGroupItem>)}
    </ToggleGroup>
  );
}
