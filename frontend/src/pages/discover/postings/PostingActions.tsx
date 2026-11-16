import { useState } from "react";
import { Ban, Check, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { type DiscardReason, type Posting, type PostingStatus } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { DiscardMenu } from "./DiscardMenu";

/** Applied / Save for later / Discard (with a reason) / Hide company, or Open application once applied. One `busy` for all. */
export function PostingActions({ p, onChange, onBlocked }: { p: Posting; onChange: () => void; onBlocked: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function setStatus(next: PostingStatus, reason?: DiscardReason) {
    setBusy(true);
    try {
      await api.setPostingStatus(p.id, next, reason && { reason });
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
    setBusy(false);
  }
  async function hideCompany() {
    setBusy(true);
    try {
      const r = await api.blockCompany(p.company);
      toast.success(`${p.company} is blocked: ${r.hidden} posting${r.hidden === 1 ? "" : "s"} hidden. Undo it in Discover settings, Rules tab, under "Blocked companies".`);
      onBlocked();
    } catch (e) {
      toast.error(errorText(e));
    }
    setBusy(false);
  }
  async function apply() {
    setBusy(true);
    try {
      const r = await api.applyPosting(p.id);
      toast.success(`Added ${r.application.company} to your applications`, {
        action: { label: "Open", onClick: () => navigate(`/applications/${r.application.id}`) },
      });
      onChange();
    } catch (e) {
      toast.error(errorText(e));
    }
    setBusy(false);
  }

  return (
    <>
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
            <DiscardMenu disabled={busy} onPick={(reason) => void setStatus("dismissed", reason)} />
          )}
          {p.drop_reason !== "blocked" && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={hideCompany} title={`Never show ${p.company} again: hides its postings and blocks new ones`}><Ban /> Hide company</Button>
          )}
        </>
      )}
      {p.status === "applied" && p.application_id && (
        <Button size="sm" variant="outline" onClick={() => navigate(`/applications/${p.application_id}`)}>Open application</Button>
      )}
    </>
  );
}
