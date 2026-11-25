import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Posting } from "@/api/discovery";
import { useDiscoveryStatus } from "@/features/discovery/discoveryStatus";
import { errorText } from "@/lib/errors";

export type WritePosting = (optimistic: Posting, write: () => Promise<Posting>) => Promise<void>;

export function usePostingWrites(reload: () => Promise<boolean>) {
  const status = useDiscoveryStatus();
  const [updates, setUpdates] = useState(new Map<string, Posting>());
  const committed = useRef(new Map<string, Posting>());
  const active = useRef(new Set<string>());
  const batch = useRef(0);

  const write: WritePosting = async (optimistic, save) => {
    const id = optimistic.id;
    if (active.current.has(id)) return;
    batch.current += 1;
    active.current.add(id);
    setUpdates((all) => new Map(all).set(id, optimistic));
    try {
      const saved = await save();
      committed.current.set(id, saved);
      setUpdates((all) => new Map(all).set(id, saved));
    } catch (e) {
      setUpdates((all) => {
        const next = new Map(all);
        const previous = committed.current.get(id);
        if (previous) next.set(id, previous);
        else next.delete(id);
        return next;
      });
      toast.error(errorText(e));
    } finally {
      active.current.delete(id);
      if (!active.current.size) {
        const settled = batch.current;
        status.refresh();
        if (await reload() && settled === batch.current) {
          committed.current.clear();
          setUpdates(new Map());
        }
      }
    }
  };

  return { updates, write };
}
