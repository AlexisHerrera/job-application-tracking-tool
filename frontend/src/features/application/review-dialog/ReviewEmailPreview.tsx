import { Mail } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, label } from "@/lib/format";
import { type ApplicationDetail } from "@/api/applications";

/** The email the application was created from, as the AI read it. */
export function ReviewEmailPreview({ detail, loading }: { detail: ApplicationDetail | null; loading: boolean }) {
  const email = detail?.events.find((ev) => ev.kind === "email");
  const emails = detail?.events.filter((ev) => ev.kind === "email").length ?? 0;
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
      {loading && !detail ? <Skeleton className="h-16 w-full" /> : email ? (
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
  );
}
