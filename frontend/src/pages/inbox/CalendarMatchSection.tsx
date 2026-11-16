import { CalendarDays } from "lucide-react";
import type { Application } from "@/api/applications";
import type { Interview } from "@/api/interviews";
import { CalendarMatchItem } from "./CalendarMatchItem";

/** Calendar events with someone from a company that has several applications: pick which one. */
export function CalendarMatchSection({ interviews, apps }: { interviews: Interview[]; apps: Application[] }) {
  return (
    <section className="mb-6 space-y-3" aria-labelledby="calendar-heading">
      <h2 id="calendar-heading" className="flex items-center gap-2 text-sm font-medium">
        <CalendarDays className="size-4 text-muted-foreground" /> Calendar interviews to match · {interviews.length}
      </h2>
      {interviews.map((iv) => <CalendarMatchItem key={iv.id} iv={iv} apps={apps} />)}
    </section>
  );
}
