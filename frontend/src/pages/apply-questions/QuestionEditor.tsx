import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/Field";
import { api } from "@/api/client";
import type { FormQuestion, QuestionCategory } from "@/api/apply";
import { errorText } from "@/lib/errors";

/** Your answer to one question, how you want it written, and its category. */
export function QuestionEditor({ question: q, categories, onSaved, onDeleted }: {
  question: FormQuestion;
  categories: QuestionCategory[];
  onSaved: (q: FormQuestion) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState({ answer: q.answer, style_notes: q.style_notes, category: q.category });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dirty = form.answer !== q.answer || form.style_notes !== q.style_notes || form.category !== q.category;
  const words = form.answer.trim() ? form.answer.trim().split(/\s+/).length : 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await api.patchApplyQuestion(q.id, form));
      toast.success("Saved");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirming) return setConfirming(true);
    try {
      await api.deleteApplyQuestion(q.id);
      onDeleted(q.id);
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  const id = `q-${q.id}`;
  return (
    <form onSubmit={save} className="space-y-4 border-t p-3">
      <Field label="Your answer" id={`${id}-answer`} hint={`${form.answer.length} characters · ${words} words`}>
        <Textarea id={`${id}-answer`} rows={8} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} placeholder="Write it the way you'd say it in an interview." />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="How you want it answered" id={`${id}-style`} hint="Length, structure, tone. Later drafts follow it.">
          <Input id={`${id}-style`} value={form.style_notes} onChange={(e) => setForm({ ...form, style_notes: e.target.value })} placeholder="3–4 sentences: context, what I did, the result" />
        </Field>
        <Field label="Category" id={`${id}-category`}>
          <NativeSelect id={`${id}-category`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {categories.map((c) => <NativeSelectOption key={c.key} value={c.key}>{c.label}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
      </div>
      {q.sources.some((s) => s.text !== q.text) && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">How each form worded it</summary>
          <ul className="mt-2 space-y-1">
            {q.sources.map((s) => <li key={s.url}><span className="font-medium">{s.company || "You"}:</span> {s.text}</li>)}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!dirty || busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive" onClick={remove} onBlur={() => setConfirming(false)}>
          {confirming ? "Click again to delete" : "Delete question"}
        </Button>
      </div>
    </form>
  );
}
