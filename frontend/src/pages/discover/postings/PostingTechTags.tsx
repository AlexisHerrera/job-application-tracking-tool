import type { Posting } from "@/api";
import { cn } from "@/lib/utils";

/** The posting's technologies; clicking one filters the list by it. */
export function PostingTechTags({ p, onTech }: { p: Posting; onTech: (tech: string) => void }) {
  const overlap = new Set(p.stack_overlap.map((t) => t.toLowerCase()));
  const techs = p.technologies.length ? p.technologies : p.stack_overlap;
  if (techs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {techs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onTech(t)}
          title={`Only postings that ask for ${t}${overlap.has(t.toLowerCase()) ? " (on your CV)" : ""}`}
          className={cn("rounded px-1.5 py-0.5 text-xs hover:ring-1 hover:ring-ring", overlap.has(t.toLowerCase()) ? "bg-primary/15 font-medium" : "bg-muted")}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
