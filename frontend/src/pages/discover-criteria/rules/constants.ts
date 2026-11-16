import type { RuleListKey } from "@/api/discoverySettings";

export const LIST_FIELDS: { key: RuleListKey; label: string; hint: string; placeholder: string }[] = [
  { key: "location_allow", label: "Locations", hint: "A posting is hidden unless its location mentions one of these (no location is kept). Company-board jobs outside them aren't stored at all.", placeholder: "uruguay" },
  { key: "seniority_exclude", label: "Seniority words", hint: "A title with one of these is hidden, AI titles too.", placeholder: "junior" },
  { key: "role_exclude", label: "Role words", hint: "Titles that aren't building software, AI titles too.", placeholder: "support engineer" },
  { key: "title_exclude", label: "Stack words", hint: "Hidden unless the title is about AI. Whole words: “java” doesn't hit JavaScript.", placeholder: "php" },
  { key: "blocked", label: "Blocked companies", hint: "Hidden, whatever the source. “Hide company” on a posting adds here.", placeholder: "Bluelight Consulting" },
  { key: "agencies", label: "Agencies & talent marketplaces", hint: "Hidden as agencies.", placeholder: "Toptal" },
  { key: "consultancies", label: "Consultancies", hint: "Hidden. The AI also hides consultancies it recognizes; those count in the total, not on a name.", placeholder: "Globant" },
];
