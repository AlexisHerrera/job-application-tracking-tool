import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/CopyButton";
import { api } from "@/api/client";
import type { Fact } from "@/api/apply";
import { errorText } from "@/lib/errors";

/** One fact: saved when the box loses focus or on Enter. */
export function FactRow({ fact, onSaved, onDeleted }: { fact: Fact; onSaved: (f: Fact) => void; onDeleted: () => void }) {
  const [value, setValue] = useState(fact.value);
  const [confirming, setConfirming] = useState(false);
  const id = `fact-${fact.key}`;

  async function save() {
    if (value.trim() === fact.value) return;
    try {
      onSaved(await api.patchApplyFact(fact.key, { value }));
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function remove() {
    if (!confirming) return setConfirming(true);
    try {
      await api.deleteApplyFact(fact.key);
      onDeleted();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <div className="grid gap-1.5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:items-center sm:gap-4">
      <label htmlFor={id} className="text-sm">
        {fact.label}
        {fact.notes && <span className="block text-xs text-muted-foreground">{fact.notes}</span>}
      </label>
      <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      <div className="flex items-center gap-1">
        <CopyButton text={fact.value} label={`Copy ${fact.label}`} />
        <Button type="button" size="icon-sm" variant="ghost" className={confirming ? "text-destructive" : "text-muted-foreground"} title={confirming ? "Click again to delete" : "Delete"} aria-label={confirming ? "Click again to delete" : `Delete ${fact.label}`} onBlur={() => setConfirming(false)} onClick={remove}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
