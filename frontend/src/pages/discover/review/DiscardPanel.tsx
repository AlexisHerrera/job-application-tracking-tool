import { useState } from "react";
import { Ban, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import type { Discard, DiscardReason } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { DISCARD_REASONS, QUICK_DISCARD_REASONS } from "@/features/discovery/discardReasons";
import { useReviewKeys } from "./useReviewKeys";

/** A click or a visible number shortcut discards the posting. The note is optional. */
export function DiscardPanel({ company, busy, hideDisabled, onPick, onCancel, onHideCompany }: { company: string; busy: boolean; hideDisabled: boolean; onPick: (d: Discard) => void; onCancel: () => void; onHideCompany: (() => void) | null }) {
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const reasons = expanded ? DISCARD_REASONS : QUICK_DISCARD_REASONS;
  const pick = (reason: DiscardReason) => !busy && onPick({ reason, note: note.trim() });

  useReviewKeys((key) => {
    if (busy) return false;
    const reason = /^[0-9]$/.test(key) ? reasons[Number(key)] : undefined;
    if (key === "escape") onCancel();
    else if (reason) pick(reason.value);
    else return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold">Why is it out?</h3>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onCancel}><X /> Cancel <Kbd className="pointer-coarse:hidden">Esc</Kbd></Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {reasons.map((r, i) => (
          <button
            key={r.value}
            type="button"
            disabled={busy}
            onClick={() => pick(r.value)}
            title={r.hint}
            className="flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-left text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <r.icon className="size-4 shrink-0 text-bad" />
            <span className="min-w-0 flex-1">
              {r.label}
              {r.detail && <span className="block text-xs font-normal text-muted-foreground">{r.detail}</span>}
            </span>
            {i < 10 && <Kbd className="pointer-coarse:hidden">{i}</Kbd>}
          </button>
        ))}
      </div>
      <Button size="sm" variant="ghost" aria-expanded={expanded} disabled={busy} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronUp /> : <ChevronDown />} {expanded ? "Fewer reasons" : "More reasons"}
      </Button>
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
