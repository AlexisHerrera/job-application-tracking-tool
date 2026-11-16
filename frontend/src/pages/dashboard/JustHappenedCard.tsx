import { CalendarCheck, NotebookPen } from "lucide-react";
import { relativeDay } from "@/lib/format";
import { type Interview } from "@/api/interviews";
import { interviewName } from "@/lib/interviews";
import { ListCard } from "./ListCard";
import { ListRow } from "./ListRow";
import { who } from "./who";

/** Interviews from the last two weeks, and whether they have notes yet. */
export function JustHappenedCard({ recent }: { recent: Interview[] }) {
  return (
    <ListCard
      icon={<CalendarCheck className="size-4 text-emerald-600" />}
      title="Just happened"
      description="Last two weeks. Write it down while it's fresh"
      empty="No interviews in the last two weeks."
    >
      {recent.map((i) => (
        <ListRow
          key={i.id}
          to={`?interview=${i.id}`}
          title={who(i)}
          sub={`${interviewName(i)} · ${relativeDay(i.starts_at)}`}
          right={
            i.notes_count > 0 ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground"><NotebookPen className="size-3.5" />{i.notes_count}</span>
            ) : (
              <span className="rounded-full bg-amber-500/10 px-2 leading-5 text-amber-800 dark:text-amber-300">add notes</span>
            )
          }
        />
      ))}
    </ListCard>
  );
}
