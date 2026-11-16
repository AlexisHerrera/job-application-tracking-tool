/** Marks a criteria chip that a rule also acts on, before any AI call. */
export function RuleMark({ value, words, rule }: { value: string; words: string[]; rule: string }) {
  if (!words.some((w) => w.toLowerCase() === value.toLowerCase())) return null;
  return (
    <span className="rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-800 dark:text-amber-300" title={`Also in the ${rule} rule: a title with it is hidden before the AI reads the posting.`}>
      rule
    </span>
  );
}
