import { api, type Interview } from "@/api";
import { RichEditor } from "./RichEditor/RichEditor";
import { SaveIndicator } from "./SaveIndicator";
import { useAutosave } from "./useAutosave";

/** A general talk (recruiter, agency): its notes are inline text on the interview. */
export function TalkDoc({ iv }: { iv: Interview }) {
  const { status, schedule } = useAutosave(async (md: string) => {
    await api.updateInterview(iv.id, { notes: md.trim() || null });
  });
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="absolute top-5 right-6"><SaveIndicator status={status} /></div>
      <RichEditor initial={iv.notes ?? ""} autoFocus onChange={schedule} placeholder="Which roles and companies came up, what they need from you, next steps…" />
    </div>
  );
}
