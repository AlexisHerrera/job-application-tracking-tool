import type { DiscoveryRules } from "@/api/discovery";

export const LIST_FIELDS: { key: keyof DiscoveryRules; label: string; hint: string }[] = [
  { key: "blocked", label: "Blocked companies", hint: "Hidden, whatever the source. \"Hide company\" on a posting adds to this list. One company per line." },
  { key: "agencies", label: "Agencies & talent marketplaces", hint: "Dropped. One company per line." },
  { key: "consultancies", label: "Consultancies", hint: "Hidden. One company per line." },
  { key: "seniority_exclude", label: "Seniority words", hint: "A title with one of these is hidden (junior, intern…)." },
  { key: "role_exclude", label: "Role words", hint: "A title with one of these is hidden, AI titles too (manager, support engineer…)." },
  { key: "title_exclude", label: "Stack words", hint: "Hidden unless the title is about AI. Whole words: \"java\" doesn't hit JavaScript." },
  { key: "location_allow", label: "Locations", hint: "A job is hidden unless its location mentions one of these (no location = kept). Company-board jobs outside these aren't stored at all. Doesn't apply to JSearch." },
];

export const GETONBRD_CATEGORIES = ["programming", "machine-learning-ai", "mobile-developer", "sysadmin-devops-qa", "data-science-analytics", "cybersecurity", "design-ux", "innovation-agile", "other"];
