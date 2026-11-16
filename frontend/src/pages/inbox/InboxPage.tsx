import { Inbox as InboxIcon } from "lucide-react";
import { api } from "@/api/client";
import { Empty, Loading, PageHeader } from "@/components/common";
import { useAsync } from "@/lib/useAsync";
import { CalendarMatchSection } from "./CalendarMatchSection";
import { UnmatchedEmailItem } from "./UnmatchedEmailItem";

export default function Inbox() {
  const inbox = useAsync(api.inbox);
  const apps = useAsync(() => api.applications());
  const calendar = useAsync(api.unassignedInterviews);
  const count = inbox.data?.length ?? 0;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Inbox"
        description={count ? `${count} job email${count === 1 ? "" : "s"} couldn't be matched. Assigning teaches the matcher: the sender gets linked to that company.` : undefined}
      />
      {apps.data && calendar.data && calendar.data.length > 0 && <CalendarMatchSection interviews={calendar.data} apps={apps.data} />}
      {!inbox.data || !apps.data ? (
        <Loading error={inbox.error ?? apps.error} loading />
      ) : count === 0 ? (
        <Empty icon={<InboxIcon className="size-8" />}>Inbox zero: every job email is matched.</Empty>
      ) : (
        <div className="space-y-3">
          {inbox.data.map((e) => <UnmatchedEmailItem key={e.id} e={e} apps={apps.data!} />)}
        </div>
      )}
    </div>
  );
}
