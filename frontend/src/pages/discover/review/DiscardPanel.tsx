import { useState } from "react";
import { Ban, Loader2, X } from "lucide-react";
import type { Discard, DiscardReason } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { DISCARD_REASONS } from "@/features/discovery/discardReasons";
import { useReviewKeys } from "./useReviewKeys";

/** Why this one is out: one click (or 1–9) on a reason discards it. The note is optional. */
export function DiscardPanel({ company, busy, hideDisabled, onPick, onCancel, onHideCompany }: { company: string; busy: boolean; hideDisabled: boolean; onPick: (d: Discard) => void; onCancel: () => void; onHideCompany: (() => void) | null }) {
  const [note, setNote] = useState("");
  const pick = (reason: DiscardReason) => !busy && onPick({ reason, note: note.trim() });

  useReviewKeys((key) => {
    if (busy) return false;
    if (key === "escape") onCancel();
    else if (/^[1-9]$/.test(key)) pick(DISCARD_REASONS[Number(key) - 1].value);
    else return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold">Why is it out?</h3>
        <span className="text-xs text-muted-foreground max-sm:hidden">The reasons add up, so the filters can be tuned later.</span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onCancel}><X /> Cancel <Kbd className="pointer-coarse:hidden">Esc</Kbd></Button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {DISCARD_REASONS.map((r, i) => (
          <button
            key={r.value}
            type="button"
            disabled={busy}
            onClick={() => pick(r.value)}
            title={r.hint}
            className="flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-left text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <r.icon className="size-4 shrink-0 text-bad" />
            <span className="min-w-0 flex-1">{r.label}</span>
            {i < 9 && <Kbd className="pointer-coarse:hidden">{i + 1}</Kbd>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (!busy && e.key === "Escape") onCancel();
            if (e.key === "Enter") pick("other");
          }}
          maxLength={500}
          placeholder="Optional note, then pick a reason (Enter saves it as Other)"
          className="min-w-0 basis-full sm:min-w-64 sm:basis-0 sm:flex-1"
        />
        {onHideCompany && (
          <Button variant="ghost" className="max-w-full text-muted-foreground" disabled={busy || hideDisabled} aria-busy={busy || undefined} onClick={onHideCompany} title={`Never show ${company} again: hides its postings and blocks new ones`}>
            {busy ? <Loader2 className="motion-safe:animate-spin" /> : <Ban />} <span className="truncate">Hide everything from {company}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
