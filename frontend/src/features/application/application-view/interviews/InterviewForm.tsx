import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "@/api/client";
import { dateTimeToIso, isoToDateTime, label } from "@/lib/format";
import { errorText } from "@/lib/errors";
import { type Interview } from "@/api/interviews";
import { Field } from "@/components/Field";
import { INTERVIEW_TYPES } from "@/lib/interviews";

export function InterviewForm({ appId, initial, round, onDone, onCancel }: { appId?: string; initial?: Interview; round?: number; onDone: () => void; onCancel: () => void }) {
  const fromCalendar = initial?.source === "calendar"; // the calendar owns its time and title
  const [f, setF] = useState({
    starts_at: isoToDateTime(initial?.starts_at ?? null),
    title: initial?.title ?? "",
    interview_type: initial?.interview_type ?? "",
    round: initial?.round ? String(initial.round) : round ? String(round) : "",
  });
  const bind = (k: keyof typeof f) => ({ id: `iv-${k}`, value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const data = {
      ...(fromCalendar ? {} : { starts_at: f.starts_at ? dateTimeToIso(f.starts_at) : undefined, title: f.title || null }),
      interview_type: f.interview_type || null,
      round: f.round ? Number(f.round) : null,
    };
    try {
      if (initial) await api.updateInterview(initial.id, data);
      else await api.addInterview(appId!, data);
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    }
  }
  return (
    <form className="space-y-3 rounded-lg border p-3" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {!fromCalendar && (
          <>
            <Field label="When" id="iv-starts_at"><Input type="datetime-local" required {...bind("starts_at")} /></Field>
            <Field label="Title" id="iv-title"><Input placeholder="Phone screen" {...bind("title")} /></Field>
          </>
        )}
        <Field label="Type" id="iv-interview_type">
          <NativeSelect className="w-full" {...bind("interview_type")}>
            <NativeSelectOption value="">—</NativeSelectOption>
            {INTERVIEW_TYPES.map((t) => <NativeSelectOption key={t} value={t}>{label(t)}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field label="Round" id="iv-round"><Input type="number" min={1} max={20} {...bind("round")} /></Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">{initial ? "Save" : "Add interview"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
