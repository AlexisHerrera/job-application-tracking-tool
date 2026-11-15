import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PostingPage } from "@/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAGE_SIZE } from "@/pages/Discover/constants";
import { PostingCard } from "./PostingCard";

/** The count line, one card per posting, and Previous / Next. */
export function PostingList({
  data,
  page,
  loading,
  set,
  onChange,
  onBlocked,
  onTech,
}: {
  data: PostingPage;
  page: number;
  loading: boolean;
  set: (key: string, value: string | null) => void;
  onChange: () => void;
  onBlocked: () => void;
  onTech: (tech: string) => void;
}) {
  return (
    <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")}>
      <p className="text-xs text-muted-foreground">
        {data.total} posting{data.total === 1 ? "" : "s"}
        {data.total > PAGE_SIZE && ` · showing ${page * PAGE_SIZE + 1}–${Math.min(data.total, (page + 1) * PAGE_SIZE)}`}
      </p>
      {data.postings.map((p) => (
        <PostingCard key={p.id} p={p} onChange={onChange} onBlocked={onBlocked} onTech={onTech} />
      ))}
      {data.total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => set("page", page > 1 ? String(page - 1) : null)}>
            <ChevronLeft /> Previous
          </Button>
          <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= data.total} onClick={() => set("page", String(page + 1))}>
            Next <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
