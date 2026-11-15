import type { ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function EditorHeader({ eyebrow, title, sub, actions, page }: { eyebrow: ReactNode; title: string; sub?: ReactNode; actions?: ReactNode; page: string | null }) {
  return (
    <header className="flex flex-wrap items-start gap-3 border-b pt-5 pr-14 pb-4 pl-6">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{eyebrow}</div>
        <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
        {sub && <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">{sub}</div>}
      </div>
      <div className="flex items-center gap-1">
        {actions}
        {page && (
          <Button asChild variant="ghost" size="xs"><Link to={page}><Maximize2 /> Open page</Link></Button>
        )}
      </div>
    </header>
  );
}
