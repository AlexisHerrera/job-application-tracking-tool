import type { Experience, ExperienceInput } from "@/api/apply";

type LongField = "summary" | "context" | "contribution" | "results";

/** The long fields of an experience, in the order a good answer tells them. */
export const STORY_FIELDS: { key: LongField; label: string; hint: string; rows: number }[] = [
  { key: "summary", label: "In one line", hint: "What it is, for whom. The sentence you'd use in \"name one or two\" answers.", rows: 2 },
  { key: "context", label: "Context", hint: "The problem, who had it, the team, the constraints and what made it hard.", rows: 5 },
  { key: "contribution", label: "What you did", hint: "Your part, not the team's: decisions you made, what you designed, built and pushed for.", rows: 6 },
  { key: "results", label: "How you knew it worked", hint: "Numbers, users, what changed after. Forms ask this as a follow-up.", rows: 4 },
];

export const EMPTY_EXPERIENCE: ExperienceInput = {
  title: "", company: "", period: "", summary: "", context: "", contribution: "", results: "", stack: "", links: "",
};

/** Plain text of one experience, to paste anywhere (an LLM chat, notes before an interview). */
export function experienceText(e: ExperienceInput): string {
  const head = [e.title, e.company, e.period].filter(Boolean).join(" · ");
  const parts = STORY_FIELDS.filter((f) => e[f.key].trim()).map((f) => `${f.label}:\n${e[f.key].trim()}`);
  if (e.stack.trim()) parts.push(`Stack: ${e.stack.trim()}`);
  if (e.links.trim()) parts.push(`Links: ${e.links.trim()}`);
  return [head, ...parts].join("\n\n");
}

export function toInput(e: Experience): ExperienceInput {
  const { title, company, period, summary, context, contribution, results, stack, links } = e;
  return { title, company, period, summary, context, contribution, results, stack, links };
}
