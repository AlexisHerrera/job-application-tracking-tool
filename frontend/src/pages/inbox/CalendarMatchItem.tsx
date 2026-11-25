import { PendingButton } from "@/components/PendingButton";
import { usePending } from "@/lib/usePending";
import { useState } from "react";
import { Ban, CalendarDays, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { fmtDate } from "@/lib/format";
import { type Application } from "@/api/applications";
import { type Interview } from "@/api/interviews";
import { useRefresh } from "@/lib/refresh";
import { ApplicationPicker } from "./ApplicationPicker";

export function CalendarMatchItem({ iv, apps }: { iv: Interview; apps: Application[] }) {
  const { pending, run: runPending } = usePending<"assign" | "general" | "dismiss">();
  const { bump } = useRefresh();
  const hint = (iv.company ?? "").toLowerCase();
  const suggested = hint ? apps.filter((a) => a.company.toLowerCase() === hint).map((a) => a.id) : [];
  const [target, setTarget] = useState(suggested.length === 1 ? suggested[0] : "");
  const others = iv.attendees.filter((a) => a !== iv.organizer).slice(0, 3);
  const run = (key: NonNullable<typeof pending>, fn: () => Promise<unknown>, done: string) => runPending(key, async () => {
    try {
      await fn();
      toast.success(done);
      bump();
    } catch (err) {
      toast.error(errorText(err));
    }
  });
  return (
    <Card className="gap-3 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="size-3.5" />
            <span className="truncate">{[iv.organizer, ...others].filter(Boolean).join(", ") || "No other attendees"}</span>
            <span className="ml-auto shrink-0">{fmtDate(iv.starts_at, true)}</span>
          </div>
          <div className="font-medium">{iv.title || "(no title)"}</div>
          {iv.company && <div className="text-sm text-muted-foreground">Someone from <em>{iv.company}</em> is on it, but it has several applications.</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationPicker apps={apps} value={target} onChange={setTarget} suggested={suggested} placeholder="Assign to… (type company, role, status)" />
          <PendingButton pending={pending === "assign"} size="sm" disabled={!target || pending !== null} onClick={() => run("assign", () => api.assignInterview(iv.id, target), "Assigned. The attendees' company domain is remembered.")}>Assign</PendingButton>
          <PendingButton pending={pending === "general"} disabled={pending !== null} size="sm" variant="outline" onClick={() => run("general", () => api.markGeneral(iv.id), "Kept as a general talk. Add notes on the Interviews page.")}>
            {pending !== "general" && <MessagesSquare />} General talk, no application
          </PendingButton>
          <PendingButton pending={pending === "dismiss"} disabled={pending !== null} size="sm" variant="ghost" onClick={() => run("dismiss", () => api.removeInterview(iv.id), "Hidden")}>{pending !== "dismiss" && <Ban />} Not an interview</PendingButton>
        </div>
      </CardContent>
    </Card>
  );
}
