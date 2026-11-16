import { Check, MessageSquareReply } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, daysAgo, errorText, type Dashboard } from "@/api";
import { useRefresh } from "@/lib/refresh";
import { ListCard } from "./ListCard";

/** Emails waiting on an answer from you. "Done" marks one as handled. */
export function AwaitingReplyCard({ needsReply }: { needsReply: Dashboard["follow_ups"]["needs_reply"] }) {
  const { bump } = useRefresh();

  async function done(eventId: string) {
    try {
      await api.markReplied(eventId);
      toast.success("Marked as handled");
      bump();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <ListCard
      icon={<MessageSquareReply className="size-4 text-amber-500" />}
      title="Waiting on your reply"
      description="Open requests on active processes"
      empty="Nothing pending."
    >
      {needsReply.map((r) => (
        <div key={r.event_id} className="flex items-center gap-2 py-2">
          <Link to={r.application_id ? `/applications?open=${r.application_id}` : "/inbox"} className="min-w-0 flex-1 rounded-md hover:underline">
            <div className="truncate text-sm font-medium">{r.company ?? "Unassigned"}</div>
            <div className="truncate text-xs text-muted-foreground">{r.subject} · {daysAgo(r.received_at)}</div>
          </Link>
          <Button size="xs" variant="outline" onClick={() => done(r.event_id)} aria-label={`Mark ${r.company ?? "email"} as handled`}>
            <Check /> Done
          </Button>
        </div>
      ))}
    </ListCard>
  );
}
