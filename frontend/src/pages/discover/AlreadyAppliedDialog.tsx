import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Posting } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorText } from "@/lib/errors";
import { useAsync } from "@/lib/useAsync";

export function AlreadyAppliedDialog({ posting, onCancel, onConfirm, bulkDisabled = false }: {
  posting: Posting;
  onCancel: () => void;
  onConfirm: (otherUnreviewedCount?: number) => void | Promise<void>;
  bulkDisabled?: boolean;
}) {
  const { data, loading, error, reload } = useAsync(() => api.otherUnreviewed(posting.id), [posting.id]);
  const [saving, setSaving] = useState(false);
  const count = data?.count ?? 0;
  const scope = count === 1 ? "1 other posting" : `${count} other postings`;
  async function confirm(otherUnreviewedCount?: number) {
    setSaving(true);
    try {
      await onConfirm(otherUnreviewedCount);
    } catch (e) {
      toast.error(errorText(e));
      void reload();
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Mark as already applied?</DialogTitle>
          <DialogDescription aria-live="polite">
            {loading ? "Checking for other unreviewed postings…" : error ? "Couldn't check for other postings." : count > 0
              ? `${posting.company} has ${scope} waiting for review. Include them if you also want to skip those roles.`
              : `There are no other postings from ${posting.company} waiting for review.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button variant="outline" disabled={saving} onClick={() => void confirm()}>Just this posting</Button>
          {!loading && !error && count > 0 && <Button disabled={saving || bulkDisabled} onClick={() => void confirm(count)}>Include {count} {count === 1 ? "other" : "others"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
