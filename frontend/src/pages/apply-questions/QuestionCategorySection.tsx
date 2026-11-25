import type { FormQuestion, QuestionCategory } from "@/api/apply";
import { QuestionCard } from "./QuestionCard";

/** One category's questions, the ones asked by the most forms first. Hidden when empty. */
export function QuestionCategorySection({ category, categories, questions, openId, onOpen, onSaved, onDeleted }: {
  category: QuestionCategory;
  categories: QuestionCategory[];
  questions: FormQuestion[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  onSaved: (q: FormQuestion) => void;
  onDeleted: (id: string) => void;
}) {
  if (!questions.length) return null;
  const sorted = [...questions].sort((a, b) => b.sources.length - a.sources.length);
  const answered = questions.filter((q) => q.answer).length;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-baseline gap-2 text-base font-semibold">
          {category.label}
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{answered}/{questions.length} answered</span>
        </h2>
        <p className="text-sm text-muted-foreground">{category.hint}</p>
      </div>
      <div className="grid gap-2">
        {sorted.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            categories={categories}
            open={openId === q.id}
            onToggle={() => onOpen(openId === q.id ? null : q.id)}
            onSaved={onSaved}
            onDeleted={onDeleted}
          />
        ))}
      </div>
    </section>
  );
}
