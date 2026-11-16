import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Save / Discard, and whether there's anything to save. */
export function SaveBar({ changed, canSave, saving, onSave, onDiscard, label, note, status }: { changed: boolean; canSave: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; label: string; note?: ReactNode; status?: string }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canSave || saving} onClick={onSave}>{saving ? "Saving…" : label}</Button>
        {changed && <Button size="sm" variant="ghost" disabled={saving} onClick={onDiscard}>Discard</Button>}
        <span className="text-xs text-muted-foreground">{changed ? "Unsaved changes" : (status ?? "Saved")}</span>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
