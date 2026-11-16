import type { ReactNode } from "react";
import { Bookmark, BookmarkX, Check, ThumbsDown, Undo2 } from "lucide-react";
import type { Posting } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { DISCARD_LABEL } from "@/features/discovery/discardReasons";

const BIG = "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-base font-semibold transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5";

function BigButton({ className, hotkey, children, ...props }: { className: string; hotkey: string; children: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn(BIG, className)} {...props}>
      {children} <Kbd className="bg-black/10 text-current dark:bg-white/15">{hotkey}</Kbd>
    </button>
  );
}

/** Discard / Save for later / Applied for a posting still to decide; what was decided, with an undo, for the others. */
export function ReviewActions({ p, pending, busy, onDiscard, onSave, onApply, onUndo, onOpenApplication }: { p: Posting; pending: boolean; busy: boolean; onDiscard: () => void; onSave: () => void; onApply: () => void; onUndo: () => void; onOpenApplication: () => void }) {
  if (p.status === "applied") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300"><Check className="size-5" /> Applied: it's in your applications</span>
        {p.application_id && <Button variant="outline" className="ml-auto" onClick={onOpenApplication}>Open application</Button>}
      </div>
    );
  }
  if (!pending || p.status === "dismissed") {
    const discarded = p.status === "dismissed";
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("inline-flex items-center gap-2 font-medium", discarded ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300")}>
          {discarded ? <ThumbsDown className="size-5" /> : <Bookmark className="size-5" />}
          {discarded ? `Discarded${p.discard_reason ? `: ${DISCARD_LABEL[p.discard_reason]}` : ""}` : "Saved for later"}
        </span>
        {discarded && p.discard_note && <span className="text-sm text-muted-foreground">“{p.discard_note}”</span>}
        <Button variant="outline" className="ml-auto" disabled={busy} onClick={onUndo}><Undo2 /> Undo <Kbd>U</Kbd></Button>
      </div>
    );
  }
  const saved = p.status === "interested";
  return (
    <div className="flex flex-wrap gap-3">
      <BigButton hotkey="D" disabled={busy} onClick={onDiscard} className="border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300">
        <ThumbsDown /> Discard
      </BigButton>
      <BigButton hotkey="S" disabled={busy} onClick={onSave} className="border-amber-500/30 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300">
        {saved ? <><BookmarkX /> Remove from saved</> : <><Bookmark /> Save for later</>}
      </BigButton>
      <BigButton hotkey="A" disabled={busy} onClick={onApply} className="border-transparent bg-emerald-600 text-white shadow-sm hover:bg-emerald-600/90">
        <Check /> I applied
      </BigButton>
    </div>
  );
}
