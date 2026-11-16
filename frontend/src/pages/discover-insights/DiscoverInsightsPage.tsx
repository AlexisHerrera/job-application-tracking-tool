// Discover → Insights: what the sources bring, what was reviewed, and what the discards say
// about the rules and the criteria. The window (?days=) scopes everything on the page.
import { api } from "@/api/client";
import { Loading, PageHeader } from "@/components/common";
import { cn } from "@/lib/utils";
import { useAsync } from "@/lib/useAsync";
import { useSearchParamsPatch } from "@/lib/useSearchParamsPatch";
import { DEFAULT_WINDOW, WINDOWS } from "./constants";
import { DiscardsCard } from "./discards/DiscardsCard";
import { InsightTiles } from "./InsightTiles";
import { NewPostingsCard } from "./postings/NewPostingsCard";
import { ReviewsCard } from "./reviews/ReviewsCard";
import { WindowPicker } from "./WindowPicker";

export default function DiscoverInsightsPage() {
  const [params, patch] = useSearchParamsPatch();
  const asked = Number(params.get("days"));
  const days = (WINDOWS as readonly number[]).includes(asked) ? asked : DEFAULT_WINDOW;
  const { data, error, loading } = useAsync(() => api.discoveryInsights(days), [days]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Insights" description="What the sources bring in, what you review, and what your discards say about the rules and the criteria." />
      <div className="mb-4">
        <WindowPicker value={days} onChange={(d) => patch({ days: d === DEFAULT_WINDOW ? null : String(d) })} />
      </div>
      {!data ? (
        <Loading error={error} loading={loading} rows={4} />
      ) : (
        // A new window keeps the last one on screen, dimmed, until it arrives.
        <div className={cn("space-y-4 transition-opacity", loading && "opacity-60")}>
          {error && <p className="text-sm text-destructive">Error: {error}</p>}
          <InsightTiles data={data} />
          <NewPostingsCard data={data} />
          <ReviewsCard data={data} />
          <DiscardsCard data={data} />
        </div>
      )}
    </div>
  );
}
