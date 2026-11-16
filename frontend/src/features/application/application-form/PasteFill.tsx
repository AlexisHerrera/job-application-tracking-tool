import { useState } from "react";
import { Link2, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { type PasteRecord } from "@/api/applications";
import type { FillReport, FillResult } from "./fill";

// Fills a form from pasted text (a LinkedIn chat with a recruiter, a job post…) using the same
// AI read as the paste assistant. The form itself is the review step: nothing is saved here.

export function PasteFill({
  onFill, onUndo, onUseExisting,
}: {
  onFill: (r: FillResult) => FillReport;
  onUndo: () => void;
  onUseExisting?: (applicationId: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<PasteRecord[] | null>(null);
  const [done, setDone] = useState<{ report: FillReport; note: string | null; existing: { id: string; label: string } | null } | null>(null);

  async function read() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { records } = await api.paste(text);
      if (records.length === 0) setError("Couldn't find a position in that text (no company or role).");
      else if (records.length === 1) apply(records[0]);
      else setChoices(records);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function apply(rec: PasteRecord) {
    // The "create new" option carries every extracted field, already normalized (salary yearly).
    const create = rec.options.find((o) => o.application_id === null);
    const values = Object.fromEntries((create?.changes ?? []).map((c) => [c.field, c.proposed]));
    const match = rec.options.find((o) => o.application_id && o.score >= 80);
    setChoices(null);
    setDone({
      report: onFill({ company: rec.company, values }),
      note: rec.salary_note,
      existing: match ? { id: match.application_id!, label: match.label.replace(/^Update /, "") } : null,
    });
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-indigo-500" /> Fill from a recruiter chat
      </div>
      <p className="text-xs text-muted-foreground">
        Paste the LinkedIn conversation (or a job post, notes…). The AI fills the form below for you to check; nothing is
        saved until you create it, and the text isn't stored. One AI call per read.
      </p>
      <Textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Recruiter chat"
        placeholder={"e.g. \"Hi Alexis! I'm recruiting for Northwind, a Series B fintech. Senior Backend Engineer, Python/AWS, remote LATAM, 6–7k USD/month…\""}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy || !text.trim()} onClick={read}>
          <Sparkles /> {busy ? "Reading…" : "Fill the form"}
        </Button>
        {done && (
          <Button type="button" size="sm" variant="ghost" onClick={() => { onUndo(); setDone(null); }}>
            <Undo2 /> Undo fill
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {choices && (
        <div className="space-y-1.5">
          <p className="text-sm">The text mentions {choices.length} positions. Which one is this?</p>
          <div className="flex flex-wrap gap-2">
            {choices.map((rec, i) => {
              const role = rec.options.find((o) => o.application_id === null)?.changes.find((c) => c.field === "role_title")?.proposed;
              return (
                <Button key={i} type="button" size="sm" variant="outline" onClick={() => apply(rec)}>
                  {rec.company ?? "Company not named"}{role ? ` · ${String(role)}` : ""}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {done && (
        <div className="space-y-1.5 text-sm" aria-live="polite">
          {done.report.filled.length + done.report.replaced.length === 0 ? (
            <p className="text-muted-foreground">Nothing new in that text for this form.</p>
          ) : (
            <>
              {done.report.filled.length > 0 && <p>Filled: {done.report.filled.join(", ")}.</p>}
              {done.report.replaced.map((r) => (
                <p key={r.label} className="text-amber-700 dark:text-amber-400">
                  Replaced {r.label}: “{r.from}” → “{r.to}”
                </p>
              ))}
            </>
          )}
          {done.report.noCompany && (
            <p className="text-amber-700 dark:text-amber-400">
              The text doesn't name the hiring company (an agency post?).{" "}
              {done.report.noCompany.kept ? `Kept “${done.report.noCompany.kept}” from the email; check it's the employer, not the agency.` : "Type it in Company."}
            </p>
          )}
          {done.note && <p className="text-muted-foreground">Salary {done.note}.</p>}
          {done.existing && onUseExisting && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-500/30 bg-indigo-500/5 p-2">
              <Link2 className="size-4 text-indigo-500" />
              <span className="flex-1">Looks like an application you already have: <strong>{done.existing.label}</strong>.</span>
              <Button type="button" size="xs" variant="outline" onClick={() => onUseExisting(done.existing!.id)}>
                Assign the email to it instead
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
