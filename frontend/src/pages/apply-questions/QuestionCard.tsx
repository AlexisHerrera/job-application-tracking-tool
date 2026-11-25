import { ChevronDown } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import type { FormQuestion, QuestionCategory, QuestionSource } from "@/api/apply";
import { QuestionEditor } from "./QuestionEditor";

/** Who asked it: "Acme, Initech" plus how many more, linked to the postings. */
function AskedBy({ sources }: { sources: QuestionSource[] }) {
  const named = sources.filter((s) => s.company);
  if (!named.length) return <span>Added by you</span>;
  const shown = named.slice(0, 4);
  return (
    <span>
      Asked by{" "}
      {shown.map((s, i) => (
        <span key={s.url}>
          {i > 0 && ", "}
          {s.url.startsWith("http") ? <a href={s.url} target="_blank" rel="noreferrer" title={s.text} className="underline-offset-2 hover:underline">{s.company}</a> : s.company}
        </span>
      ))}
      {named.length > shown.length && ` and ${named.length - shown.length} more`}
    </span>
  );
}

export function QuestionCard({ question: q, categories, open, onToggle, onSaved, onDeleted }: {
  question: FormQuestion;
  categories: QuestionCategory[];
  open: boolean;
  onToggle: () => void;
  onSaved: (q: FormQuestion) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <div className={cn("rounded-lg border bg-card", open && "ring-1 ring-ring/30")}>
      <div className="flex items-start gap-2 p-3">
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", q.answer ? "bg-emerald-500" : "bg-muted-foreground/30")} />
        <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <p className="text-sm font-medium">{q.text}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <AskedBy sources={q.sources} />
          </p>
          {!open && q.answer && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{q.answer}</p>}
        </button>
        <CopyButton text={q.answer} label="Copy answer" />
        <button type="button" onClick={onToggle} aria-label={open ? "Close" : "Answer"} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent">
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && <QuestionEditor question={q} categories={categories} onSaved={onSaved} onDeleted={onDeleted} />}
    </div>
  );
}
