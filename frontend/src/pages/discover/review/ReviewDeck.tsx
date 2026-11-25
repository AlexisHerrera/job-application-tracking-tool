import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Discard, Posting, PostingPage, PostingStatus } from "@/api/discovery";
import { Loading } from "@/components/common";
import { useDiscoveryStatus } from "@/features/discovery/discoveryStatus";
import { errorText } from "@/lib/errors";
import { safeUrl } from "@/lib/links";
import { DiscardPanel } from "./DiscardPanel";
import { ReviewActions } from "./ReviewActions";
import { ReviewCard } from "./ReviewCard";
import { ReviewDone } from "./ReviewDone";
import { ReviewProgress } from "./ReviewProgress";
import { useReviewKeys } from "./useReviewKeys";
import { useReviewQueue } from "./useReviewQueue";

/** The postings one at a time: read, decide, next. Every button has a key. */
export function ReviewDeck({ data, query, onBlocked, onTech }: { data: PostingPage; query: Record<string, string>; onBlocked: () => void; onTech: (tech: string) => void }) {
  const writes = useRef(new Set<string>());
  const [writing, setWriting] = useState(0);
  const q = useReviewQueue(data, query, writing > 0);
  const navigate = useNavigate();
  const status = useDiscoveryStatus();
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const p = q.current;
  const saving = !!p && writes.current.has(p.id);
  const pending = !!p && q.isPending(p) && p.status !== "applied" && p.status !== "dismissed";

  async function decide(before: Posting, optimistic: Posting, write: () => Promise<Posting>) {
    if (busy || writes.current.has(before.id)) return;
    writes.current.add(before.id);
    setWriting(writes.current.size);
    q.replace(optimistic);
    setDiscarding(false);
    q.next();
    try {
      q.replace(await write());
    } catch (e) {
      q.replace(before);
      toast.error(errorText(e), { action: { label: "Return to posting", onClick: () => {
        setDiscarding(false);
        q.goTo(before.id);
      } } });
    } finally {
      writes.current.delete(before.id);
      setWriting(writes.current.size);
      if (!writes.current.size) status.refresh();
    }
  }

  const setStatus = (next: PostingStatus, discard?: Discard) => {
    if (!p) return;
    const optimistic = { ...p, status: next, discard_reason: discard?.reason ?? null, discard_note: discard?.note ?? null };
    return decide(p, optimistic, async () => {
      const r = await api.setPostingStatus(p.id, next, discard);
      return { ...p, status: r.status, discard_reason: r.discard_reason, discard_note: r.discard_note };
    });
  };
  const apply = () => {
    if (!p) return;
    const optimistic = { ...p, status: "applied" as const, discard_reason: null, discard_note: null };
    return decide(p, optimistic, async () => {
      const r = await api.applyPosting(p.id);
      toast.success(`Added ${r.application.company} to your applications`, { action: { label: "Open", onClick: () => navigate(`/applications/${r.application.id}`) } });
      return { ...optimistic, application_id: r.application.id };
    });
  };
  async function hideCompany() {
    if (!p || busy || writes.current.size) return;
    setBusy(true);
    try {
      const r = await api.blockCompany(p.company);
      toast.success(`${p.company} is blocked: ${r.hidden} posting${r.hidden === 1 ? "" : "s"} hidden. Undo it in Criteria, Rules tab, under "Blocked companies".`);
      setDiscarding(false);
      onBlocked();
      status.refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const save = () => setStatus(p?.status === "interested" ? "new" : "interested");
  // Undo goes back to what the queue shows; a discarded posting seen in the "Not for me" queue goes back to new.
  const undo = () => p && p.status !== "applied" && setStatus(p.status === q.home ? "new" : q.home);
  const move = (step: () => void) => {
    setDiscarding(false);
    step();
  };

  useReviewKeys((key) => {
    if (discarding || busy) return false;
    if (saving && ["u", "d", "s", "a"].includes(key)) return false;
    const url = p && safeUrl(p.url);
    if (key === "arrowleft") move(q.back);
    else if (key === "arrowright" && p) move(q.next);
    else if (key === "o" && url) window.open(url, "_blank", "noopener,noreferrer");
    else if (key === "u" && p && !pending) void undo();
    else if (key === "d" && pending) setDiscarding(true);
    else if (key === "s" && pending) void save();
    else if (key === "a" && pending) void apply();
    else return false;
    return true;
  });

  return (
    <div>
      <ReviewProgress q={q} atEnd={!p} />
      {p ? (
        <>
          <ReviewCard key={p.id} p={p} onTech={onTech} />
          <div className="sticky bottom-3 z-10 mt-3 rounded-2xl border bg-card/95 p-3 shadow-lg backdrop-blur">
            {discarding && pending ? (
              <DiscardPanel company={p.company} busy={busy} hideDisabled={writing > 0} onPick={(d) => void setStatus("dismissed", d)} onCancel={() => setDiscarding(false)} onHideCompany={p.drop_reason === "blocked" ? null : () => void hideCompany()} />
            ) : (
              <ReviewActions p={p} pending={pending} busy={busy || saving} saving={saving} onDiscard={() => setDiscarding(true)} onSave={() => void save()} onApply={() => void apply()} onUndo={() => void undo()} onOpenApplication={() => navigate(`/applications/${p.application_id}`)} />
            )}
          </div>
        </>
      ) : q.loadingMore || q.error ? (
        <Loading error={q.error} loading={q.loadingMore} />
      ) : (
        <ReviewDone q={q} />
      )}
    </div>
  );
}
