import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { type Application } from "@/api/applications";

export function NeedsReviewBanner({ app, onReviewed }: { app: Application; onReviewed: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <Sparkles className="size-4 text-amber-600" />
      <span className="flex-1">Created automatically from an email. Check the company and role.</span>
      <Button size="sm" onClick={async () => { await api.markReviewed(app.id); toast.success("Marked as reviewed"); onReviewed(); }}>
        <Check /> Looks right
      </Button>
    </div>
  );
}
