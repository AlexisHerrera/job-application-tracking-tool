import type { ReactNode } from "react";
import { Bookmark, BookmarkX, Check, ThumbsDown, Undo2 } from "lucide-react";
import type { Posting } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { DISCARD_LABEL } from "@/features/discovery/discardReasons";

const BIG = "inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 sm:gap-2 sm:px-4 sm:text-base [&_svg]:size-5 [&_svg]:shrink-0";
// Discard and Save are plain outlined buttons; only the icon carries the signal colour. "I applied" is the one filled button.
const DISCARD = "border-input text-foreground hover:bg-accent [&_svg]:text-bad";
const SAVE = "border-input text-foreground hover:bg-accent [&_svg]:text-warn";

function BigButton({ className, hotkey, children, ...props }: { className: string; hotkey: string; children: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn(BIG, className)} {...props}>
      {children} <Kbd className="bg-current/10 text-current pointer-coarse:hidden">{hotkey}</Kbd>
    </button>
  );
}

/** The full label from sm up, a short one on a phone so the three buttons fit one row. */
function Label({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className="truncate sm:hidden">{short}</span>
      <span className="truncate max-sm:hidden">{full}</span>
    </>
  );
}

/** Discard / Save for later / Applied for a posting still to decide; what was decided, with an undo, for the others. */
export function ReviewActions({ p, pending, busy, onDiscard, onSave, onApply, onUndo, onOpenApplication }: { p: Posting; pending: boolean; busy: boolean; onDiscard: () => void; onSave: () => void; onApply: () => void; onUndo: () => void; onOpenApplication: () => void }) {
  if (p.status === "applied") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 font-medium text-good"><Check className="size-5" /> Applied: it's in your applications</span>
        {p.application_id && <Button variant="outline" className="ml-auto" onClick={onOpenApplication}>Open application</Button>}
      </div>
    );
  }
  if (!pending || p.status === "dismissed") {
    const discarded = p.status === "dismissed";
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("inline-flex items-center gap-2 font-medium", discarded ? "text-bad" : "text-foreground")}>
          {discarded ? <ThumbsDown className="size-5" /> : <Bookmark className="size-5" />}
          {discarded ? `Discarded${p.discard_reason ? `: ${DISCARD_LABEL[p.discard_reason]}` : ""}` : "Saved for later"}
        </span>
        {discarded && p.discard_note && <span className="text-sm text-muted-foreground">“{p.discard_note}”</span>}
        <Button variant="outline" className="ml-auto" disabled={busy} onClick={onUndo}><Undo2 /> Undo <Kbd className="pointer-coarse:hidden">U</Kbd></Button>
      </div>
    );
  }
  const saved = p.status === "interested";
  return (
    <div className="flex gap-2 sm:gap-3">
      <BigButton hotkey="D" disabled={busy} onClick={onDiscard} className={DISCARD}>
        <ThumbsDown /> Discard
      </BigButton>
      <BigButton hotkey="S" disabled={busy} onClick={onSave} className={SAVE}>
        {saved ? <><BookmarkX /><Label full="Remove from saved" short="Unsave" /></> : <><Bookmark /><Label full="Save for later" short="Save" /></>}
      </BigButton>
      <BigButton hotkey="A" disabled={busy} onClick={onApply} className="border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
        <Check /><Label full="I applied" short="Applied" />
      </BigButton>
    </div>
  );
}
