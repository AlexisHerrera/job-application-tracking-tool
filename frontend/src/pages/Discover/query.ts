import { FILTER_PARAMS, PAGE_SIZE } from "./constants";

export type View = "match" | "maybe" | "no" | "unscored" | "all" | "hidden";
export type StatusFilter = "open" | "interested" | "applied" | "dismissed" | "any";

export function queryFor(params: URLSearchParams): Record<string, string> {
  const view = (params.get("view") ?? "all") as View;
  const status = (params.get("status") ?? "open") as StatusFilter;
  const q: Record<string, string> = {};
  if (view === "hidden") q.hidden = "true";
  else if (view !== "all") q.verdict = view;
  if (status === "open") q.status = "new,interested";
  else if (status !== "any") q.status = status;
  for (const [key, apiKey] of Object.entries(FILTER_PARAMS)) {
    const v = params.get(key);
    if (v) q[apiKey] = v;
  }
  if (params.get("ai") === "1") q.ai = "true";
  q.sort = params.get("sort") ?? "score";
  q.limit = String(PAGE_SIZE);
  q.offset = String(pageOf(params) * PAGE_SIZE);
  return q;
}

export const pageOf = (params: URLSearchParams) => Math.max(0, Number(params.get("page") ?? "0") || 0);
export const techsOf = (params: URLSearchParams) => (params.get("tech") ?? "").split(",").filter(Boolean);
