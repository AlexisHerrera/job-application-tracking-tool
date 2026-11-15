import type { ReactNode } from "react";

/** One thing to deal with: an icon, what it is, why, and the button that does it. */
export function AttentionItem({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action: ReactNode }) {
  return (
    <div className="flex flex-1 items-center gap-3">
      {icon}
      <div className="flex-1 text-sm">
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground">{description}</div>
      </div>
      {action}
    </div>
  );
}
