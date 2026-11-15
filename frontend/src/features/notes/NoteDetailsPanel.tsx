import { Field } from "@/components/Field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { topicsOf, type Draft } from "./draft";
import { SelfRating } from "./SelfRating";

/** The side panel next to the document: rating, interviewers, topics, questions, went well/wrong. */
export function NoteDetailsPanel({ draft, change }: { draft: Draft; change: (patch: Partial<Draft>) => void }) {
  const bind = (k: "interviewers" | "questions" | "went_well" | "went_wrong" | "topics") => ({
    id: `doc-${k}`,
    value: draft[k],
    onChange: (e: { target: { value: string } }) => change({ [k]: e.target.value }),
  });
  const topics = topicsOf(draft);

  return (
    <aside className="space-y-4 overflow-y-auto border-t bg-muted/30 px-5 py-4 md:border-t-0 md:border-l" aria-label="Details">
      <SelfRating value={draft.self_rating} onChange={(self_rating) => change({ self_rating })} />
      <Field label="Interviewers" id="doc-interviewers"><Input placeholder="Jane (EM), Bob (Staff)" {...bind("interviewers")} /></Field>
      <Field label="Topics to study" id="doc-topics" hint="Comma separated">
        <Input placeholder="sql indexes, k8s networking" {...bind("topics")} />
        {topics.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">{topics.map((t) => <span key={t} className="rounded bg-indigo-500/10 px-1.5 text-xs leading-5 text-indigo-700 dark:text-indigo-300">{t}</span>)}</div>
        )}
      </Field>
      <Field label="Questions asked" id="doc-questions" hint="One per line"><Textarea rows={4} {...bind("questions")} /></Field>
      <Field label="What went well" id="doc-went_well"><Textarea rows={2} {...bind("went_well")} /></Field>
      <Field label="What went wrong" id="doc-went_wrong"><Textarea rows={2} {...bind("went_wrong")} /></Field>
    </aside>
  );
}
