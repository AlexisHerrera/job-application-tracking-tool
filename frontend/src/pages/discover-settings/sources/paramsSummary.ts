import type { DiscoverySearch } from "@/api/discovery";

export function paramsSummary(x: DiscoverySearch): string {
  if (x.source === "getonbrd") return `category ${String(x.params.category ?? "")}`;
  if (x.source === "remoteyeah") return String(x.params.feed ?? "").replace("https://remoteyeah.com/", "");
  return [x.params.query && `"${x.params.query}"`, x.params.location].filter(Boolean).join(" · ");
}
