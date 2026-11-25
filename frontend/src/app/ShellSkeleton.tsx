import { Skeleton } from "@/components/ui/skeleton";
import { RouteSkeleton } from "./RouteSkeleton";

export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh bg-background">
      <aside aria-hidden="true" className="hidden w-60 shrink-0 space-y-4 border-r bg-sidebar px-4 py-6 md:block">
        <Skeleton className="mb-8 h-7 w-40 bg-sidebar-accent" />
        {Array.from({ length: 7 }, (_, row) => (
          <Skeleton key={row} className="h-7 w-full bg-sidebar-accent" />
        ))}
      </aside>
      <div className="min-w-0 flex-1">
        <div aria-hidden="true" className="flex h-14 items-center gap-3 border-b px-4 md:hidden">
          <Skeleton className="size-6" />
          <Skeleton className="h-5 w-32" />
        </div>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8">
          <RouteSkeleton />
        </main>
      </div>
    </div>
  );
}
