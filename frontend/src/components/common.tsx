import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { type Status } from "../api";
import { STATUS_META } from "../lib/status";

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_META[status]?.dot, className)} />;
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap", meta?.badge, className)}>
      <StatusDot status={status} />
      {meta?.label ?? status}
    </span>
  );
}

export function ReviewBadge({ className, children = "to review" }: { className?: string; children?: ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full bg-amber-500/15 px-2 text-xs font-medium text-amber-800 dark:text-amber-300", className)}>
      {children}
    </span>
  );
}

export function Loading({ error, loading, rows = 3 }: { error: string | null; loading: boolean; rows?: number }) {
  if (error) return <p className="text-sm text-destructive">Error: {error}</p>;
  if (!loading) return null;
  return (
    <div className="space-y-3" aria-busy>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}
