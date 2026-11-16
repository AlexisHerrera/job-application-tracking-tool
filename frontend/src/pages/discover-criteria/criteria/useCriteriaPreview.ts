import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { CriteriaPreview, CriteriaProfile } from "@/api/discoverySettings";
import { errorText } from "@/lib/errors";

/** The criteria text the fields render to, asked from the server 400 ms after the last edit. */
export function useCriteriaPreview(profile: CriteriaProfile) {
  const [preview, setPreview] = useState<CriteriaPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(profile);
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api.previewCriteria(JSON.parse(key) as CriteriaProfile);
        if (!stale) {
          setPreview(r);
          setError(null);
        }
      } catch (e) {
        if (!stale) setError(errorText(e));
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [key]);
  return { preview, error };
}
