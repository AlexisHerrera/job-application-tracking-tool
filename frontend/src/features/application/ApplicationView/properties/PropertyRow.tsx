import type { ReactNode } from "react";
import type { Mail } from "lucide-react";

export function PropertyRow({ icon: Icon, label: text, children }: { icon: typeof Mail; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <div className="flex h-8 items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4 shrink-0" />{text}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
