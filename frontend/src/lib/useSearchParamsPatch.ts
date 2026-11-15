import { useSearchParams } from "react-router-dom";

export type ParamsPatch = Record<string, string | null>;

/** The URL's search params and `patch`, which sets the given keys and removes the empty ones,
 * replacing the history entry. One call per change: react-router hands the functional form the
 * params of the last render, so several calls in a row would each start from the same old params. */
export function useSearchParamsPatch() {
  const [params, setParams] = useSearchParams();
  const patch = (changes: ParamsPatch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  return [params, patch] as const;
}
