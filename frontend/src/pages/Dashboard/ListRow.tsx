import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

export function ListRow({ to, title, sub, right }: { to: string; title: string; sub: string; right: ReactNode }) {
  return (
    <Link to={to} className="group flex min-w-0 flex-1 items-center gap-2 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium group-hover:underline">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="shrink-0 text-xs">{right}</div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
