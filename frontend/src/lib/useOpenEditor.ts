import { useSearchParams } from "react-router-dom";

/** Opens the editor over the current page, keeping the rest of the URL (an open sheet, filters). */
export function useOpenEditor() {
  const [params, setParams] = useSearchParams();
  return (kind: "interview" | "note", id: string) => {
    const next = new URLSearchParams(params);
    next.delete("interview");
    next.delete("note");
    next.set(kind, id);
    setParams(next, { replace: true });
  };
}
