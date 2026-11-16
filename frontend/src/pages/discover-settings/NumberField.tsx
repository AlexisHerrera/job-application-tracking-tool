import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A whole number, or null when left empty. */
export function NumberField({ label, value, placeholder, hint, onChange }: { label: string; value: number | null; placeholder?: string; hint?: string; onChange: (v: number | null) => void }) {
  const id = useId();
  const parse = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v.replace(/[,_\s]/g, ""))) || 0));
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} className="h-8" inputMode="numeric" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(parse(e.target.value))} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
