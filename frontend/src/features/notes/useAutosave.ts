import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorText } from "@/lib/errors";

// Saves still running, so whoever closes the editor can refresh after they land.
const inflight = new Set<Promise<void>>();
export const settled = () => Promise.all([...inflight]);

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Debounced saves, one at a time, in order; whatever is pending is saved on unmount. */
export function useAutosave<T>(save: (value: T) => Promise<void>, delay = 700) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<{ value: T } | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const pending = latest.current;
    if (!pending) return;
    latest.current = null;
    setStatus("saving");
    const p = chain.current
      .then(() => saveRef.current(pending.value))
      .then(() => setStatus((s) => (latest.current ? s : "saved")))
      .catch((e) => {
        setStatus("error");
        toast.error(`Notes not saved: ${errorText(e)}`);
      });
    chain.current = p;
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  }, []);

  const schedule = useCallback((value: T) => {
    latest.current = { value };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  }, [flush, delay]);

  useEffect(() => () => flush(), [flush]);
  return { status, schedule };
}
