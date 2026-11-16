import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { fmtDate } from "@/lib/format";
import { type Application } from "@/api/applications";
import { StatusBadge } from "@/components/common";
import { useRefresh } from "@/lib/refresh";
import { useAsync } from "@/lib/useAsync";
import { ReviewActions } from "./ReviewActions";
import { ReviewEmailPreview } from "./ReviewEmailPreview";
import { ReviewProgress } from "./ReviewProgress";

// Applications created automatically from an email start flagged "to review". This walks the
// queue one at a time: Enter confirms, S skips, D deletes (twice), E edits the role.

export function ReviewDialog({ open, onOpenChange, campaign = "all" }: { open: boolean; onOpenChange: (o: boolean) => void; campaign?: string }) {
  const { bump } = useRefresh();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<Application[] | null>(null);
  const [index, setIndex] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [role, setRole] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const roleInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQueue(null);
    setIndex(0);
    setReviewed(0);
    api.applications({ needs_review: "true", campaign }).then(setQueue, (e) => toast.error(errorText(e)));
  }, [open, campaign]);

  const current = queue?.[index] ?? null;
  const detail = useAsync(() => (current ? api.application(current.id) : Promise.resolve(null)), [current?.id]);
  useEffect(() => {
    setRole(current?.role_title ?? "");
    setConfirmDelete(false);
  }, [current?.id, current?.role_title]);

  const drop = (id: string) => {
    const next = (queue ?? []).filter((a) => a.id !== id);
    setQueue(next);
    setIndex((i) => (next.length ? Math.min(i, next.length - 1) : 0));
  };

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const confirm = () => run(async () => {
    if (!current) return;
    if (role.trim() && role.trim() !== current.role_title) await api.updateApplication(current.id, { role_title: role.trim() });
    await api.markReviewed(current.id);
    setReviewed((n) => n + 1);
    drop(current.id);
    bump();
  });

  const remove = () => {
    if (!current) return;
    if (!confirmDelete) return setConfirmDelete(true);
    void run(async () => {
      await api.deleteApplication(current.id);
      toast.success(`Deleted ${current.company}. Its emails are back in the inbox.`);
      drop(current.id);
      bump();
    });
  };

  const move = (step: number) => queue?.length && setIndex((i) => (i + step + queue.length) % queue.length);

  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.target instanceof HTMLButtonElement && (k === "enter" || k === " ")) return; // a focused button keeps its meaning
    if (k === "enter" || k === "y") void confirm();
    else if (k === "s" || k === "arrowright") move(1);
    else if (k === "arrowleft") move(-1);
    else if (k === "d" || k === "delete") remove();
    else if (k === "e") roleInput.current?.focus();
    else return;
    e.preventDefault();
  }

  const total = (queue?.length ?? 0) + reviewed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="sm:max-w-xl"
        onKeyDown={onKeyDown}
        // Focus the dialog itself, not the role input, so the letter shortcuts work right away.
        onOpenAutoFocus={(e) => { e.preventDefault(); content.current?.focus(); }}
      >
        <DialogHeader>
          <DialogTitle>Review applications created from email</DialogTitle>
          <DialogDescription>
            Check the company and role. Wrong company? Delete it and its emails go back to the inbox for assigning.
          </DialogDescription>
        </DialogHeader>

        {queue === null && <Skeleton className="h-56 w-full" />}

        {queue && queue.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="size-10 text-emerald-500" />
            <div className="font-medium">All caught up</div>
            <p className="text-sm text-muted-foreground">{reviewed ? `${reviewed} reviewed.` : "Nothing waiting for review."}</p>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}

        {current && (
          <div className="space-y-4">
            <ReviewProgress index={index} left={queue!.length} reviewed={reviewed} total={total} />

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl font-semibold tracking-tight">{current.company}</span>
                <StatusBadge status={current.status} />
                <span className="text-sm text-muted-foreground">applied {fmtDate(current.applied_at)}</span>
              </div>
              <Input
                ref={roleInput}
                aria-label="Role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void confirm(); }
                  if (e.key === "Escape") { e.stopPropagation(); setRole(current.role_title); e.currentTarget.blur(); }
                }}
              />
            </div>

            <ReviewEmailPreview detail={detail.data} loading={detail.loading} />

            <ReviewActions
              busy={busy}
              confirmDelete={confirmDelete}
              canConfirm={!!role.trim()}
              onDelete={remove}
              onOpen={() => { onOpenChange(false); navigate(`/applications/${current.id}`); }}
              onMove={move}
              onConfirm={() => void confirm()}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
