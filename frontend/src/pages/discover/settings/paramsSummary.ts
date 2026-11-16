import type { DiscoverySearch } from "@/api/discovery";

export function paramsSummary(x: DiscoverySearch): string {
  if (x.source === "getonbrd") return `category ${String(x.params.category ?? "")}`;
  if (x.source === "remoteyeah") return String(x.params.feed ?? "").replace("https://remoteyeah.com/", "");
  if (x.source === "workable") return [x.params.query && `"${x.params.query}"`, x.params.location].filter(Boolean).join(" · ");
  const parts = [`"${x.params.query}"`];
  if (x.params.country) parts.push(String(x.params.country).toUpperCase());
  if (x.params.work_from_home) parts.push("remote only");
  return parts.join(" · ");
}
