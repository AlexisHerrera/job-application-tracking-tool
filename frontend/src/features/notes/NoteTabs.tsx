import { cn } from "@/lib/utils";

/** "Note 1 / Note 2": shown when an interview has more than one note. */
export function NoteTabs({ slots, active, onSelect }: { slots: { key: string }[]; active: string; onSelect: (key: string) => void }) {
  return (
    <div className="flex gap-1 border-b px-6 py-1.5" role="tablist" aria-label="Notes">
      {slots.map((s, i) => (
        <button
          key={s.key}
          type="button"
          role="tab"
          aria-selected={s.key === active}
          onClick={() => onSelect(s.key)}
          className={cn("rounded-full px-2.5 py-0.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50", s.key === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
        >
          Note {i + 1}
        </button>
      ))}
    </div>
  );
}
