import { useState } from "react";
import { Ban, Check, Loader2, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useDiscoveryStatus } from "@/features/discovery/discoveryStatus";
import { errorText } from "@/lib/errors";
import { type DiscardReason, type Posting, type PostingStatus } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { AlreadyAppliedDialog } from "@/pages/discover/AlreadyAppliedDialog";
import { DiscardMenu } from "./DiscardMenu";
import { type WritePosting } from "./usePostingWrites";

/** Applied / Save for later / Discard (with a reason) / Hide company, or Open application once applied. One `busy` for all. */
export function PostingActions({ p, write, onBlocked }: { p: Posting; write: WritePosting; onBlocked: () => void }) {
  const navigate = useNavigate();
  const status = useDiscoveryStatus();
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function setStatus(next: PostingStatus, reason?: DiscardReason, otherUnreviewedCount?: number) {
    setBusy(true);
    try {
      await write({ ...p, status: next, discard_reason: reason ?? null, discard_note: null }, async () => {
        const saved = await api.setPostingStatus(p.id, next, reason && { reason, otherUnreviewedCount });
        if (saved.other_discarded) toast.success(`${saved.other_discarded + 1} postings marked as already applied`);
        return { ...p, status: saved.status, discard_reason: saved.discard_reason, discard_note: saved.discard_note };
      });
    } finally {
      setBusy(false);
    }
  }
  const [blocking, setBlocking] = useState(false);
  async function hideCompany() {
    setBlocking(true);
    setBusy(true);
    try {
      const r = await api.blockCompany(p.company);
      toast.success(`${p.company} is blocked: ${r.hidden} posting${r.hidden === 1 ? "" : "s"} hidden. Undo it in Criteria, Rules tab, under "Blocked companies".`);
      onBlocked();
      status.refresh();
    } catch (e) {
      toast.error(errorText(e));
    }
    setBusy(false);
    setBlocking(false);
  }
  async function apply() {
    setBusy(true);
    const optimistic = { ...p, status: "applied" as const, discard_reason: null, discard_note: null };
    try {
      await write(optimistic, async () => {
        const r = await api.applyPosting(p.id);
        toast.success(`Added ${r.application.company} to your applications`, {
          action: { label: "Open", onClick: () => navigate(`/applications/${r.application.id}`) },
        });
        return { ...optimistic, application_id: r.application.id };
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {busy && !blocking && <span role="status" className="inline-flex items-center gap-2 text-xs"><Loader2 className="size-4 motion-safe:animate-spin" /> Saving…</span>}
      {p.status !== "applied" && (
        <>
          <Button size="sm" disabled={busy} onClick={apply}><Check /> Applied</Button>
          {p.status === "interested" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("new")}><Star className="fill-current" /> Saved</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("interested")}><Star /> Save for later</Button>
          )}
          {p.status === "dismissed" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus("new")}>Undo discard</Button>
          ) : (
            <DiscardMenu disabled={busy} onPick={(reason) => reason === "already_applied" ? setConfirmDiscard(true) : void setStatus("dismissed", reason)} />
          )}
          {p.drop_reason !== "blocked" && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={hideCompany} title={`Never show ${p.company} again: hides its postings and blocks new ones`}>{blocking ? <Loader2 className="motion-safe:animate-spin" /> : <Ban />} Hide company</Button>
          )}
        </>
      )}
      {p.status === "applied" && p.application_id && (
        <Button size="sm" variant="outline" onClick={() => navigate(`/applications/${p.application_id}`)}>Open application</Button>
      )}
      {confirmDiscard && <AlreadyAppliedDialog posting={p} onCancel={() => setConfirmDiscard(false)} onConfirm={(otherUnreviewedCount) => {
        setConfirmDiscard(false);
        return setStatus("dismissed", "already_applied", otherUnreviewedCount);
      }} />}
    </>
  );
}
