import { ArrowLeft, ArrowRight, Check, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/** Delete / open the full page on the left; previous, skip and confirm on the right. */
export function ReviewActions({ busy, confirmDelete, canConfirm, onDelete, onOpen, onMove, onConfirm }: {
  busy: boolean;
  confirmDelete: boolean;
  canConfirm: boolean;
  onDelete: () => void;
  onOpen: () => void;
  onMove: (step: number) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={confirmDelete ? "destructive" : "ghost"} size="sm" disabled={busy} onClick={onDelete}>
        <Trash2 /> {confirmDelete ? "Press again to delete" : "Not a real application"} <Kbd>D</Kbd>
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Open full page" onClick={onOpen}>
        <ExternalLink />
      </Button>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => onMove(-1)}><ArrowLeft /></Button>
        <Button variant="outline" size="sm" onClick={() => onMove(1)}>Skip <Kbd>S</Kbd><ArrowRight /></Button>
        <Button size="sm" disabled={busy || !canConfirm} onClick={onConfirm}>
          <Check /> Looks right <Kbd className="bg-primary-foreground/20 text-primary-foreground">↵</Kbd>
        </Button>
      </div>
    </div>
  );
}
