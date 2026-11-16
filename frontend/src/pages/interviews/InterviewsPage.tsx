import { CalendarDays } from "lucide-react";
import { api } from "@/api/client";
import { Empty, Loading, PageHeader } from "@/components/common";
import { useAsync } from "@/lib/useAsync";
import { InterviewGroup } from "./InterviewGroup";

/** Every interview in one list: what's next, what just happened, and general recruiter talks. */
export default function Interviews() {
  const { data, error, loading } = useAsync(api.interviews);
  if (!data) return <Loading error={error} loading={loading} rows={5} />;
  const now = new Date().toISOString();
  const upcoming = data.filter((iv) => iv.starts_at >= now);
  const past = data.filter((iv) => iv.starts_at < now).reverse();
  const done = past.filter((iv) => !iv.general).length;
  const general = data.filter((iv) => iv.general).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Interviews"
        description={`${done} done · ${upcoming.filter((iv) => !iv.general).length} upcoming${general ? ` · plus ${general} general talk${general === 1 ? "" : "s"}` : ""}. From Google Calendar, invite emails, and the ones you added.`}
      />
      {data.length === 0 ? (
        <Empty icon={<CalendarDays className="size-8" />}>No interviews yet.</Empty>
      ) : (
        <div className="space-y-6">
          <InterviewGroup title="Upcoming" items={upcoming} empty="Nothing scheduled." />
          <InterviewGroup title="Past" items={past} empty="None yet." />
        </div>
      )}
    </div>
  );
}
