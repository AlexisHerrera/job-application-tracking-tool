import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function Field({ label: text, id, children, hint, tag }: { label: string; id?: string; children: ReactNode; hint?: string; tag?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{text}</Label>
        {tag && <span className="rounded bg-indigo-500/10 px-1.5 text-xs leading-5 text-indigo-700 dark:text-indigo-300">{tag}</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
