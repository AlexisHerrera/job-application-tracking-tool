import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { fmtSalary } from "@/lib/format";
import { type Application } from "@/api/applications";
import type { Patch } from "@/features/application/application-view/patch";
import { draftFrom, readSalary } from "@/features/application/salary";
import { SalaryInputs } from "@/features/application/SalaryInputs";
import { ghostField } from "./ghostField";

export function SalaryField({ app, save }: { app: Application; save: (p: Patch) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(app));
  const text = fmtSalary(app);
  const read = readSalary(draft);

  if (!editing) {
    return (
      <button
        type="button"
        className={ghostField}
        onClick={() => {
          setDraft(draftFrom(app));
          setEditing(true);
        }}
      >
        {text ?? <span className="text-muted-foreground">Add yearly range</span>}
      </button>
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!read.patch) return;
    await save(read.patch);
    setEditing(false);
  }
  return (
    <form onSubmit={submit} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} className="space-y-2 rounded-lg border p-3">
      <SalaryInputs value={draft} onChange={setDraft} autoFocus />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!read.patch}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </form>
  );
}
