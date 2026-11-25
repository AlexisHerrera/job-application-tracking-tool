import { usePostingWrites } from "./usePostingWrites";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PostingPage } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAGE_SIZE } from "@/pages/discover/constants";
import { PostingCard } from "./PostingCard";

/** The count line, one card per posting, and Previous / Next. */
export function PostingList({
  data,
  page,
  loading,
  set,
  reload,
  onBlocked,
  onTech,
}: {
  data: PostingPage;
  page: number;
  loading: boolean;
  set: (key: string, value: string | null) => void;
  reload: () => Promise<boolean>;
  onBlocked: () => void;
  onTech: (tech: string) => void;
}) {
  const { updates, write } = usePostingWrites(reload);
  return (
    <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")}>
      <p className="text-xs text-muted-foreground">
        {data.total} posting{data.total === 1 ? "" : "s"}
        {data.total > PAGE_SIZE && ` · showing ${page * PAGE_SIZE + 1}–${Math.min(data.total, (page + 1) * PAGE_SIZE)}`}
      </p>
      {data.postings.map((p) => (
        <PostingCard key={p.id} p={updates.get(p.id) ?? p} write={write} onBlocked={onBlocked} onTech={onTech} />
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
