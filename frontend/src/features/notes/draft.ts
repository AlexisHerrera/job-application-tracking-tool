import type { Interview, Note } from "@/api/interviews";

// One note: the document plus the structured bits the study report will read.

export interface Draft {
  body: string;
  interviewers: string;
  self_rating: number | null;
  questions: string;
  went_well: string;
  went_wrong: string;
  topics: string;
}

export const draftOf = (n: Note | null): Draft => ({
  body: n?.body ?? "",
  interviewers: n?.interviewers ?? "",
  self_rating: n?.self_rating ?? null,
  questions: n?.questions.join("\n") ?? "",
  went_well: n?.went_well ?? "",
  went_wrong: n?.went_wrong ?? "",
  topics: n?.topics_to_study.join(", ") ?? "",
});

export const isEmpty = (d: Draft) =>
  !d.self_rating && ![d.body, d.interviewers, d.questions, d.went_well, d.went_wrong, d.topics].some((v) => v.trim());

export const topicsOf = (d: Draft) => d.topics.split(",").map((t) => t.trim()).filter(Boolean);

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** The draft as the body of a note save. */
export const noteData = (d: Draft, interview: Interview | null, note: Note | null): Partial<Note> => ({
  interview_id: interview?.id ?? null,
  body: d.body.trim() || null,
  interviewers: d.interviewers.trim() || null,
  // Tied to an interview, the note takes its round, date and type from it.
  round: interview ? interview.round : note?.round ?? null,
  interview_at: interview ? interview.starts_at : note?.interview_at ?? null,
  interview_type: interview ? interview.interview_type : note?.interview_type ?? null,
  questions: lines(d.questions),
  self_rating: d.self_rating,
  went_well: d.went_well.trim() || null,
  went_wrong: d.went_wrong.trim() || null,
  topics_to_study: topicsOf(d),
});
