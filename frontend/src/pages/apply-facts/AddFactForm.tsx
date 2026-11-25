import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/api/client";
import type { Fact } from "@/api/apply";
import { errorText } from "@/lib/errors";

export function AddFactForm({ onAdded }: { onAdded: (f: Fact) => void }) {
  const [label, setLabel] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      onAdded(await api.addApplyFact(label));
      setLabel("");
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  return (
    <form onSubmit={add} className="flex gap-2 pt-3">
      <Input aria-label="New fact" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Another one forms keep asking, e.g. Driver's license?" />
      <Button type="submit" variant="outline" disabled={!label.trim()}>Add</Button>
    </form>
  );
}
