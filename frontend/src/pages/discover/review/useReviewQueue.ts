import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { Posting, PostingPage } from "@/api/discovery";

/** The postings to go through one at a time. Starts from the page the list loaded and fetches
 * the next ones when the end is reached. A posting is "pending" while its status is still one
 * the queue asks for: deciding on it takes it out, skipping leaves it in. */
export function useReviewQueue(first: PostingPage, query: Record<string, string>, writing: boolean) {
  const [source, setSource] = useState(first);
  const [items, setItems] = useState(first.postings);
  const latestItems = useRef(items);
  useEffect(() => { latestItems.current = items; }, [items]);
  const [index, setIndex] = useState(0);
  const [exhausted, setExhausted] = useState(first.postings.length >= first.total);
  const [error, setError] = useState<string | null>(null);
  if (source !== first) {
    // A new first page (filters changed, or a run finished): start over.
    setSource(first);
    setItems(first.postings);
    setIndex(0);
    setExhausted(first.postings.length >= first.total);
    setError(null);
  }

  const statuses = (query.status ?? "").split(",").filter(Boolean);
  const isPending = (p: Posting) => statuses.length === 0 || statuses.includes(p.status);
  const pending = items.filter(isPending).length;
  const needMore = index >= items.length && !exhausted && !error;

  useEffect(() => {
    if (!needMore || writing) return;
    let stale = false;
    // Decided postings have left the server's list, so the next ones start after the pending ones.
    api
      .postings({ ...query, offset: String(pending) })
      .then((page) => {
        if (stale) return;
        const known = new Set(items.map((p) => p.id));
        const fresh = page.postings.filter((p) => !known.has(p.id));
        if (fresh.length === 0) setExhausted(true);
        else setItems((all) => [...all, ...fresh]);
      })
      .catch((e: unknown) => !stale && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needMore, writing, source]);

  return {
    current: items[index] as Posting | undefined,
    index,
    loadingMore: needMore,
    error,
    isPending,
    /** The status a pending posting has here: what "undo" goes back to. */
    home: (statuses[0] ?? "new") as Posting["status"],
    decided: items.length - pending,
    skipped: items.slice(0, index).filter(isPending).length,
    left: Math.max(0, first.total - (items.length - pending)),
    total: first.total,
    next: () => setIndex((i) => Math.min(i + 1, items.length)),
    back: () => setIndex((i) => Math.max(i - 1, 0)),
    /** Back to the first posting that was skipped. */
    restart: () => setIndex(Math.max(0, items.findIndex(isPending))),
    goTo: (id: string) => {
      const i = latestItems.current.findIndex((item) => item.id === id);
      if (i >= 0) setIndex(i);
    },
    replace: (p: Posting) => setItems((all) => all.map((x) => (x.id === p.id ? p : x))),
  };
}

export type ReviewQueue = ReturnType<typeof useReviewQueue>;
