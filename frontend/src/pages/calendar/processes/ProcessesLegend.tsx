import { Legend } from "@/pages/calendar/Legend";

export function ProcessesLegend() {
  return (
    <Legend>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-(--flow-screening)" /> moving</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-(--flow-screening) opacity-30" /> quiet since the last news</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-muted-foreground/30" /> closed</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-amber-500" /> first reply</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-violet-500" /> interview</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full ring-2 ring-violet-500 ring-inset" /> scheduled</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-primary/50" /> today</span>
    </Legend>
  );
}
