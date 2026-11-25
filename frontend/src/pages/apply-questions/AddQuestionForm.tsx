import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/Field";
import { api } from "@/api/client";
import type { FormQuestion, QuestionCategory } from "@/api/apply";
import { errorText } from "@/lib/errors";

const EMPTY = { text: "", company: "", category: "" };

/** Paste a question from a form you're filling in. One you already have opens instead. */
export function AddQuestionForm({ categories, onAdded }: { categories: QuestionCategory[]; onAdded: (q: FormQuestion) => void }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { created, question } = await api.addApplyQuestion({ text: form.text, company: form.company, category: form.category || null });
      const where = categories.find((c) => c.key === question.category)?.label ?? question.category;
      toast.success(created ? `Added to ${where}` : `You already have it, in ${where}`);
      onAdded(question);
      setForm(EMPTY);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a question</CardTitle>
        <CardDescription>Paste one from a form. With the company, "Why Acme?" joins the other "why us" questions.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={add}>
          <Field label="Question" id="aq-text">
            <Textarea id="aq-text" rows={2} required value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="What's the most impactful thing you've built?" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company" id="aq-company" hint="Optional">
              <Input id="aq-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </Field>
            <Field label="Category" id="aq-category">
              <NativeSelect id="aq-category" className="w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <NativeSelectOption value="">Pick for me</NativeSelectOption>
                {categories.map((c) => <NativeSelectOption key={c.key} value={c.key}>{c.label}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
          </div>
          <Button type="submit" disabled={busy || !form.text.trim()}>Add question</Button>
        </form>
      </CardContent>
    </Card>
  );
}
