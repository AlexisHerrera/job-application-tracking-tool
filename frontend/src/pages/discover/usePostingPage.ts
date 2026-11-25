import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { PostingPage } from "@/api/discovery";
import { errorText } from "@/lib/errors";
import { useRefresh } from "@/lib/refresh";

export function usePostingPage(query: Record<string, string>) {
  const key = new URLSearchParams(query).toString();
  const { version } = useRefresh();
  const currentKey = useRef<string | null>(null);
  const sequence = useRef(0);
  const [page, setPage] = useState<{ key: string; data: PostingPage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    currentKey.current = key;
    return () => {
      currentKey.current = null;
      sequence.current += 1;
    };
  }, [key]);

  const reload = useCallback(async (quiet = false) => {
    const key = currentKey.current;
    if (key === null) return false;
    const request = ++sequence.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await api.postings(Object.fromEntries(new URLSearchParams(key)));
      if (sequence.current !== request) return false;
      setPage({ key, data });
      setError(null);
      return true;
    } catch (e) {
      if (sequence.current === request && !quiet) setError(errorText(e));
      return false;
    } finally {
      if (sequence.current === request) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => { sequence.current += 1; };
  }, [key, reload, version]);

  return { data: page?.key === key ? page.data : null, error, loading, reload };
}
