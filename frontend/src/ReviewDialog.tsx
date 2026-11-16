import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ExternalLink, Mail, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, fmtDate, label, type Application } from "./api";
import { StatusBadge } from "./components/common";
import { useRefresh } from "./lib/refresh";
import { useAsync } from "@/lib/useAsync";

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

  const email = detail.data?.events.find((ev) => ev.kind === "email");
  const emails = detail.data?.events.filter((ev) => ev.kind === "email").length ?? 0;
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
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{index + 1} of {queue!.length} left</span>
                <span>{reviewed} of {total} done</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${total ? (100 * reviewed) / total : 0}%` }} />
              </div>
            </div>

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

            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
              {detail.loading && !detail.data ? <Skeleton className="h-16 w-full" /> : email ? (
                <>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Mail className="size-3.5" />
                    <span className="truncate">{email.from_name} &lt;{email.from_address}&gt;</span>
                    <span className="ml-auto shrink-0">{fmtDate(email.occurred_at)}</span>
                  </div>
                  <div className="font-medium">{email.subject}</div>
                  <div className="text-muted-foreground">
                    {label(email.event_type)}
                    {email.extracted_company && <> · read as <em>{email.extracted_company}</em>{email.extracted_role && <> / {email.extracted_role}</>}</>}
                    {email.confidence != null && <> · {Math.round(email.confidence * 100)}% sure</>}
                  </div>
                  {email.summary && <p>{email.summary}</p>}
                  {email.snippet && <p className="line-clamp-3 border-l-2 pl-2 text-muted-foreground italic">{email.snippet}</p>}
                  {emails > 1 && <div className="text-xs text-muted-foreground">+{emails - 1} more email(s) on this application</div>}
                </>
              ) : (
                <span className="text-muted-foreground">No email attached.</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant={confirmDelete ? "destructive" : "ghost"} size="sm" disabled={busy} onClick={remove}>
                <Trash2 /> {confirmDelete ? "Press again to delete" : "Not a real application"} <Kbd>D</Kbd>
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Open full page" onClick={() => { onOpenChange(false); navigate(`/applications/${current.id}`); }}>
                <ExternalLink />
              </Button>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => move(-1)}><ArrowLeft /></Button>
                <Button variant="outline" size="sm" onClick={() => move(1)}>Skip <Kbd>S</Kbd><ArrowRight /></Button>
                <Button size="sm" disabled={busy || !role.trim()} onClick={() => void confirm()}>
                  <Check /> Looks right <Kbd className="bg-primary-foreground/20 text-primary-foreground">↵</Kbd>
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
