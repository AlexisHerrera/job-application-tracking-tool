import { Skeleton } from "@/components/ui/skeleton";

export function RouteSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}
