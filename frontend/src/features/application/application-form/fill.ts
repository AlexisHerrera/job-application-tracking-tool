export type FillResult = { company: string | null; values: Record<string, unknown> };
export type FillReport = {
  filled: string[];
  replaced: { label: string; from: string; to: string }[];
  /** Set when the text doesn't name the hiring company: the form's company (if any) was kept. */
  noCompany?: { kept: string | null };
};
