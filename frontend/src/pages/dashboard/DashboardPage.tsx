import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useCampaign } from "@/campaign";
import { Loading, PageHeader } from "@/components/common";
import { ReviewDialog } from "@/ReviewDialog";
import { useAsync } from "@/useAsync";
import { AwaitingReplyCard } from "./AwaitingReplyCard";
import { FlowCard } from "./FlowCard";
import { InterviewTypesCard } from "./interview-types/InterviewTypesCard";
import { JustHappenedCard } from "./JustHappenedCard";
import { KpiTiles } from "./KpiTiles";
import { ListCard } from "./ListCard";
import { MiniCalendar } from "./MiniCalendar";
import { NeedsAttentionCard } from "./NeedsAttentionCard";
import { NoNewsCard } from "./NoNewsCard";
import { UpcomingInterviewsCard } from "./UpcomingInterviewsCard";

export default function DashboardPage() {
  const { selected: campaign } = useCampaign();
  const { data, error, loading } = useAsync(api.dashboard);
  const stats = useAsync(() => api.stats(campaign), [campaign]).data;
  const insights = useAsync(() => api.insights(campaign), [campaign]).data;
  const [reviewing, setReviewing] = useState(false);
  if (!data) return <Loading error={error} loading={loading} rows={4} />;
  const { upcoming_interviews: upcoming, recent_interviews: recent, follow_ups: fu } = data;
  const c = data.campaign;

  const tiles = <KpiTiles stats={stats} campaign={c} besideCalendar={upcoming.length > 0} />;

  return (
    <>
      {/* Title only: the campaign's name is in the sidebar, its day in the first tile. */}
      <PageHeader
        title="Dashboard"
        description={c ? undefined : <>No ongoing campaign. <Link to="/campaigns" className="text-primary hover:underline">Start one</Link> to group this search.</>}
      />

      {/* When something's coming up: the KPI tiles, then the upcoming interviews, with a month
          calendar beside both (a month is about as tall as the two together). */}
      {upcoming.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_17rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {tiles}
            <UpcomingInterviewsCard upcoming={upcoming} />
          </div>
          <MiniCalendar className="hidden lg:flex" />
        </div>
      ) : (
        tiles
      )}

      <NeedsAttentionCard data={data} onReview={() => setReviewing(true)} />

      <FlowCard flow={stats?.flow} />

      <div className={`mt-4 grid gap-4 ${upcoming.length > 0 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {upcoming.length === 0 && <ListCard icon={<CalendarClock className="size-4 text-violet-500" />} title="Upcoming interviews" empty="None scheduled.">{[]}</ListCard>}
        <JustHappenedCard recent={recent} />
        <AwaitingReplyCard needsReply={fu.needs_reply} />
        <NoNewsCard noNews={fu.no_news} />
      </div>

      {insights && <div className="mt-4"><InterviewTypesCard data={insights} /></div>}

      <ReviewDialog open={reviewing} onOpenChange={setReviewing} />
    </>
  );
}
