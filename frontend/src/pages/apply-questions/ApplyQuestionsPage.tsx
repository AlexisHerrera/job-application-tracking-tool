import { useState } from "react";
import { Loading, PageHeader } from "@/components/common";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/api/client";
import type { FormQuestion } from "@/api/apply";
import { useAsync } from "@/lib/useAsync";
import { AddQuestionForm } from "./AddQuestionForm";
import { QuestionCategorySection } from "./QuestionCategorySection";

type Show = "all" | "unanswered";

export default function ApplyQuestionsPage() {
  const { data, error, loading, setData } = useAsync(api.applyQuestions);
  const [show, setShow] = useState<Show>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  function put(q: FormQuestion) {
    setData((d) => d && { ...d, questions: d.questions.some((x) => x.id === q.id) ? d.questions.map((x) => (x.id === q.id ? q : x)) : [...d.questions, q] });
  }
  function remove(id: string) {
    setData((d) => d && { ...d, questions: d.questions.filter((x) => x.id !== id) });
  }

  const questions = data?.questions ?? [];
  const answered = questions.filter((q) => q.answer).length;
  const visible = show === "all" ? questions : questions.filter((q) => !q.answer);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Questions"
        description="What application forms ask, grouped by what they want to know. Answer each once here, then copy it into the form."
        actions={
          data && (
            <ToggleGroup type="single" variant="outline" size="sm" value={show} onValueChange={(v) => v && setShow(v as Show)}>
              <ToggleGroupItem value="all">All {questions.length}</ToggleGroupItem>
              <ToggleGroupItem value="unanswered">To answer {questions.length - answered}</ToggleGroupItem>
            </ToggleGroup>
          )
        }
      />
      <Loading error={error} loading={loading && !data} />
      {data && (
        <div className="grid gap-8">
          <AddQuestionForm
            categories={data.categories}
            onAdded={(q) => {
              put(q);
              setOpenId(q.id);
            }}
          />
          {data.categories.map((c) => (
            <QuestionCategorySection
              key={c.key}
              category={c}
              categories={data.categories}
              questions={visible.filter((q) => q.category === c.key)}
              openId={openId}
              onOpen={setOpenId}
              onSaved={put}
              onDeleted={remove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
