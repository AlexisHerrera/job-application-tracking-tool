import { useSyncExternalStore } from "react";
import { getSlowRequestCount, subscribeToRequests } from "@/api/client";

export function ApiProgress() {
  const count = useSyncExternalStore(subscribeToRequests, getSlowRequestCount);
  if (!count) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 bg-primary/25"
      role="progressbar" aria-label="Request in progress">
      <div className="h-full w-full bg-primary motion-safe:animate-pulse" />
    </div>
  );
}
