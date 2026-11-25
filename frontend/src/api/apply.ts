// The Apply pages: your experience, the questions application forms ask, and the facts.

export interface QuestionCategory {
  key: string;
  label: string;
  hint: string;
}

export interface QuestionSource {
  url: string;
  company: string;
  role_title: string;
  ats: string;
  /** The question as that form wrote it. */
  text: string;
  seen_at: string | null;
}

export interface FormQuestion {
  id: string;
  text: string;
  category: string;
  answer: string;
  style_notes: string;
  answered_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  sources: QuestionSource[];
}

export interface QuestionInput {
  text: string;
  category?: string | null;
  company?: string;
  url?: string;
}

export type QuestionPatch = Partial<Pick<FormQuestion, "text" | "category" | "answer" | "style_notes">>;

export interface Experience {
  id: string;
  title: string;
  company: string;
  period: string;
  summary: string;
  context: string;
  contribution: string;
  results: string;
  stack: string;
  links: string;
  position: number;
  created_at: string | null;
  updated_at: string | null;
}

export type ExperienceInput = Omit<Experience, "id" | "position" | "created_at" | "updated_at">;

export interface Fact {
  key: string;
  label: string;
  value: string;
  notes: string;
  position: number;
  updated_at: string | null;
}
