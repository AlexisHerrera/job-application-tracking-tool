import { useState } from "react";
import { errorText } from "@/lib/errors";
import { PendingButton } from "@/components/PendingButton";
import { usePending } from "@/lib/usePending";
import { Mail, PenLine } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { fmtDate, label } from "@/lib/format";
import { type TimelineEvent } from "@/api/applications";
import { STATUS_META } from "@/lib/status";

export function EventItem({ e, awaiting, onDone }: { e: TimelineEvent; awaiting: boolean; onDone: () => void }) {
  const { pending, run: runPending } = usePending<"done">();
  const [handled, setHandled] = useState(false);
  const mark = () => runPending("done", async () => {
    setHandled(true);
    try {
      await api.markReplied(e.id);
      toast.success("Marked as handled");
      onDone();
    } catch (err) {
      setHandled(false);
      toast.error(errorText(err));
    }
  });
  const manual = e.kind === "manual";
  const Icon = manual ? PenLine : Mail;
  return (
    <li className="relative">
      <span className="absolute top-0.5 -left-[1.9rem] grid size-5 place-items-center rounded-full border bg-background">
        <Icon className="size-3 text-muted-foreground" />
      </span>
      <div className="text-xs text-muted-foreground">
        {fmtDate(e.occurred_at, true)} · {manual ? "you" : e.from_name || e.from_address}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {e.event_type === "manual_stage_change" && e.stage_implied ? <>→ {STATUS_META[e.stage_implied].label}</> : label(e.event_type)}
        {e.round ? <span className="font-normal text-muted-foreground">round {e.round}</span> : null}
        {e.interview_at && <span className="font-normal text-muted-foreground">· {fmtDate(e.interview_at, true)}</span>}
        {awaiting && (!handled || pending) && (
          <PendingButton pending={pending !== null}
            size="xs"
            variant="outline"
            className="border-amber-500/40 text-amber-700 dark:text-amber-300"
            onClick={mark}
          >
            {pending ? "Marking as handled…" : "reply needed · mark done"}
          </PendingButton>
        )}
      </div>
      {e.subject && <div className="text-sm">{e.subject}</div>}
      {e.summary && <div className="text-sm text-muted-foreground">{e.summary}</div>}
    </li>
  );
}
