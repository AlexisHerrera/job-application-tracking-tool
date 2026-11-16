import type { ReactNode } from "react";
import type { Mail } from "lucide-react";

export function Section({ icon: Icon, title, children }: { icon: typeof Mail; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-muted-foreground" />{title}</h3>
      {children}
    </section>
  );
}
