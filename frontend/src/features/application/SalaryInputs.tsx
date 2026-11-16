import { useId } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { CURRENCIES, fmt, formatLive, parseAmount, readSalary, type SalaryDraft } from "./salary";

export function SalaryInputs({ value, onChange, autoFocus }: { value: SalaryDraft; onChange: (d: SalaryDraft) => void; autoFocus?: boolean }) {
  const id = useId();
  const read = readSalary(value);
  const currencies = CURRENCIES.includes(value.currency) ? CURRENCIES : [value.currency, ...CURRENCIES];
  const amount = (key: "min" | "max", text: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-${key}`}>{text}</Label>
      <InputGroup>
        <InputGroupAddon><InputGroupText className="text-xs">{value.currency}</InputGroupText></InputGroupAddon>
        <InputGroupInput
          id={`${id}-${key}`}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus && key === "min"}
          placeholder={key === "min" ? "90,000 or 90k" : "110,000"}
          value={value[key]}
          onChange={(e) => onChange({ ...value, [key]: formatLive(e.target.value) })}
          onBlur={() => {
            const n = parseAmount(value[key]);
            if (n !== null && !Number.isNaN(n)) onChange({ ...value, [key]: fmt(n) });
          }}
          aria-invalid={!!read.error}
        />
      </InputGroup>
    </div>
  );
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-3">
        {amount("min", "From")}
        {amount("max", "To (optional)")}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect size="sm" aria-label="Currency" value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })}>
          {currencies.map((c) => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
        </NativeSelect>
        <ToggleGroup type="single" size="sm" variant="outline" value={value.period} onValueChange={(p) => p && onChange({ ...value, period: p as SalaryDraft["period"] })} aria-label="Amounts are">
          <ToggleGroupItem value="year">per year</ToggleGroupItem>
          <ToggleGroupItem value="month">per month</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p className={cn("text-sm", read.error ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
        {read.error ?? read.text ?? "Gross amount. Leave empty if unknown."}
      </p>
      {read.hint && <p className="text-sm text-amber-700 dark:text-amber-400">{read.hint}</p>}
    </div>
  );
}
