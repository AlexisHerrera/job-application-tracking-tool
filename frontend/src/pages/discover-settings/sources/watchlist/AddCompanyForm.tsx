import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Ats } from "@/api/discoverySettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { errorText } from "@/lib/errors";
import { ATS_LABELS } from "./constants";

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Watch one more board, by ATS and slug (the board is read once first). */
export function AddCompanyForm({ onAdded }: { onAdded: () => void }) {
  const [ats, setAts] = useState<Ats>("ashby");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  async function add() {
    setAdding(true);
    try {
      const c = await api.watchCompany({ ats, slug: slug.trim(), name: name.trim() || undefined });
      toast.success(`Watching ${c.name}: ${c.jobs_kept ?? 0} of its ${c.jobs_total ?? 0} jobs are engineering roles in your locations.`);
      setSlug("");
      setName("");
      onAdded();
    } catch (e) {
      toast.error(errorText(e));
    }
    setAdding(false);
  }

  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect size="sm" value={ats} onChange={(e) => setAts(e.target.value as Ats)} aria-label="ATS">
          {Object.entries(ATS_LABELS).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
        </NativeSelect>
        <Input className="h-8 w-40" placeholder="Board slug" value={slug} onChange={(e) => setSlug(e.target.value)} aria-label="Board slug" />
        <Input className="h-8 min-w-32 flex-1" placeholder="Company name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" variant="outline" disabled={adding || !SLUG.test(slug.trim())} onClick={add}>
          <Plus /> {adding ? "Reading the board…" : "Watch"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The slug is the board's name in its URL: jobs.ashbyhq.com/<b>slug</b>, job-boards.greenhouse.io/<b>slug</b>, jobs.lever.co/<b>slug</b> (Lever's is case-sensitive). From a company's website, use a terminal: <code>jobtracker discover companies add &lt;url&gt;</code>
      </p>
    </div>
  );
}
