import { useCallback, useEffect, useRef, useState } from "react";
import { useRefresh } from "./refresh";

export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const { version } = useRefresh();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Only the newest load may set state: an older one (deps changed, e.g. a quick navigation)
  // can answer last, especially when it hit a cold Lambda.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const call = ++latest.current;
    setLoading(true);
    try {
      const result = await load();
      if (call !== latest.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (call !== latest.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (call === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
