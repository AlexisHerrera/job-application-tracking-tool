import type { DiscoveryState } from "@/api/discovery";
import { SearchesSection } from "./SearchesSection";
import { WatchlistCard } from "./watchlist/WatchlistCard";

/** Where postings come from: the saved searches and the watched company boards. */
export function SourcesTab({ state, onChange }: { state: DiscoveryState; onChange: () => void }) {
  return (
    <div className="space-y-4">
      <SearchesSection searches={state.searches} onChange={onChange} />
      <WatchlistCard state={state} onChange={onChange} />
    </div>
  );
}
