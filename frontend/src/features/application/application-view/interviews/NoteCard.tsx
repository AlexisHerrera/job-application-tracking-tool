import { fmtDate } from "@/lib/format";
import { type Note } from "@/api/interviews";
import { interviewName } from "@/lib/interviews";
import { plainText } from "@/lib/notes";

export function NoteCard({ n, onOpen }: { n: Note; onOpen: () => void }) {
  const heading = n.round || n.interview_type ? interviewName({ title: null, interview_type: n.interview_type, round: n.round }) : "General";
  const preview = plainText(n.body) || [n.went_well, n.went_wrong, n.questions.join(" · ")].filter(Boolean).join(" · ");
  return (
    <button type="button" onClick={onOpen} className="block w-full space-y-0.5 rounded-lg border p-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
      <div className="flex items-center gap-2">
        <span className="font-medium">{heading}</span>
        {n.interview_at && <span className="text-muted-foreground">{fmtDate(n.interview_at)}</span>}
        {n.self_rating ? <span className="text-amber-500" aria-label={`${n.self_rating} of 5`}>{"★".repeat(n.self_rating)}<span className="text-muted-foreground/40">{"★".repeat(5 - n.self_rating)}</span></span> : null}
      </div>
      <p className="line-clamp-2 text-muted-foreground">{preview || "Empty note"}</p>
    </button>
  );
}
