import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/CopyButton";
import type { Experience, ExperienceInput } from "@/api/apply";
import { ExperienceForm } from "./ExperienceForm";
import { STORY_FIELDS, experienceText, toInput } from "./experienceFields";

export function ExperienceCard({ experience: e, onSave, onDelete }: {
  experience: Experience;
  onSave: (data: ExperienceInput) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const missing = STORY_FIELDS.filter((f) => !e[f.key].trim()).map((f) => f.label.toLowerCase());

  if (editing) {
    return (
      <Card>
        <CardContent>
          <ExperienceForm
            initial={toInput(e)}
            idPrefix={`exp-${e.id}`}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSave={async (data) => {
              const ok = await onSave(data);
              if (ok) setEditing(false);
              return ok;
            }}
          />
          <Button type="button" size="sm" variant="ghost" className="mt-2 text-destructive" onBlur={() => setConfirming(false)} onClick={() => (confirming ? onDelete() : setConfirming(true))}>
            {confirming ? "Click again to delete" : "Delete"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{e.title}</h2>
            <p className="text-xs text-muted-foreground">{[e.company, e.period, e.stack].filter(Boolean).join(" · ")}</p>
          </div>
          <CopyButton text={experienceText(e)} label="Copy as text" />
          <Button type="button" size="icon-sm" variant="ghost" title="Edit" aria-label="Edit" onClick={() => setEditing(true)}><Pencil /></Button>
        </div>
        {STORY_FIELDS.filter((f) => e[f.key].trim()).map((f) => (
          <div key={f.key}>
            <h3 className="text-xs font-medium text-muted-foreground">{f.label}</h3>
            <p className="text-sm whitespace-pre-line">{e[f.key]}</p>
          </div>
        ))}
        {e.links && <p className="text-xs break-all text-muted-foreground">{e.links}</p>}
        {missing.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Still to write: {missing.join(", ")}</p>}
      </CardContent>
    </Card>
  );
}
