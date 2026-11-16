import type { ApplicationDetail } from "@/api/applications";
import { awaitingReply } from "./awaitingReply";
import { EventItem } from "./EventItem";

export function ActivitySection({ app, onDone }: { app: ApplicationDetail; onDone: () => void }) {
  return app.events.length === 0 ? (
    <p className="text-sm text-muted-foreground">No events yet. Emails show up here.</p>
  ) : (
    <ol className="relative space-y-4 border-l pl-5">
      {[...app.events].reverse().map((e) => <EventItem key={e.id} e={e} awaiting={awaitingReply(app, e)} onDone={onDone} />)}
    </ol>
  );
}
