import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import { type ProcessStep, type StepKind } from "@/api/applications";
import { attempt, KIND_LABEL } from "./timeline";

export function PlanStepRow({ step, index, count, onDone }: { step: ProcessStep; index: number; count: number; onDone: () => void }) {
  const [name, setName] = useState(step.name);
  const save = (data: Parameters<typeof api.updateStep>[1]) => attempt(api.updateStep(step.id, data), onDone);
  return (
    <li className="flex items-center gap-1.5">
      <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
      <Input
        aria-label={`Step ${index + 1} name`}
        className="h-8 min-w-0 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name.trim() !== step.name) void save({ name: name.trim() }); else setName(step.name); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <NativeSelect size="sm" aria-label="Kind" className="w-28" value={step.kind} onChange={(e) => void save({ kind: e.target.value as StepKind })}>
        {(Object.keys(KIND_LABEL) as StepKind[]).map((k) => <NativeSelectOption key={k} value={k}>{KIND_LABEL[k]}</NativeSelectOption>)}
      </NativeSelect>
      <Button
        variant={step.optional ? "secondary" : "ghost"}
        size="xs"
        aria-pressed={step.optional}
        title="Might not happen (e.g. 4–5 rounds)"
        className={cn(!step.optional && "text-muted-foreground")}
        onClick={() => void save({ optional: !step.optional })}
      >
        maybe
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={index === 0} onClick={() => void save({ position: index - 1 })}><ArrowUp /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={index === count - 1} onClick={() => void save({ position: index + 1 })}><ArrowDown /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Delete step" onClick={() => void attempt(api.deleteStep(step.id), onDone)}><X /></Button>
    </li>
  );
}
