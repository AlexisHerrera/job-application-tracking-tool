import { useEffect, useRef } from "react";

/** Single-key shortcuts for the review screen. Off while typing in a field or holding a modifier.
 * The handler gets the lowercased key and returns true when it used it. */
export function useReviewKeys(handler: (key: string) => boolean) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      if (latest.current(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
