import { pointerWithin, rectIntersection, type CollisionDetection } from "@dnd-kit/core";
import type { Application } from "@/api/applications";

// Pointer first (precise when the cursor is inside a column), rectangles as the keyboard fallback.
export const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

// Soonest upcoming interview first, then most recent activity.
export function byUrgency(a: Application, b: Application): number {
  const now = Date.now();
  const ia = time(a.next_interview_at) > now ? time(a.next_interview_at) : Infinity;
  const ib = time(b.next_interview_at) > now ? time(b.next_interview_at) : Infinity;
  if (ia !== ib) return ia - ib;
  return time(b.last_event_at ?? b.applied_at) - time(a.last_event_at ?? a.applied_at);
}
