import type { DiscardReasonRow } from "@/api/discoveryInsights";
import { EMPLOYER, SENIORITY, WORK_MODE } from "@/features/discovery/postingLabels";
import { DETAIL_TITLE, SOURCE_LABEL } from "@/pages/discover-insights/constants";
import { SplitList } from "./SplitList";

const DETAIL_VALUE: Partial<Record<string, (v: string | number) => string>> = {
  years: (v) => `${v}+ years`,
  salary: (v) => `USD ${v}–${Number(v) + 10}k`,
  work_mode: (v) => WORK_MODE[v] ?? String(v),
  employer_kind: (v) => EMPLOYER[v] ?? String(v),
};

/** Where a reason's discards came from, what the AI had said of them, and the notes left. */
export function ReasonDetails({ row }: { row: DiscardReasonRow }) {
  const v = row.verdicts;
  const said = [
    v.match && `${v.match} match`,
    v.maybe && `${v.maybe} maybe`,
    v.no && `${v.no} no`,
    v.unscored && `${v.unscored} not scored`,
  ].filter(Boolean);
  const detail = row.detail;
  const show = detail ? DETAIL_VALUE[detail.kind] : undefined;
  return (
    <div className="mt-3 space-y-3 rounded-md bg-muted/50 p-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3 xl:grid-cols-5">
        <SplitList title="Source" values={row.splits.source} show={(s) => SOURCE_LABEL[s] ?? s} />
        <SplitList title="Board" values={row.splits.publisher} />
        <SplitList title="Seniority" values={row.splits.seniority} show={(s) => SENIORITY[s] ?? s} />
        <SplitList title="Company" values={row.splits.company} />
        {detail && <SplitList title={DETAIL_TITLE[detail.kind]} values={detail.values} show={show} />}
      </div>
      <p className="text-xs text-muted-foreground">The AI had said: {said.join(" · ")}.</p>
      {row.notes.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground">Your notes</h4>
          <ul className="mt-1 space-y-1 text-xs">
            {row.notes.map((n, i) => (
              <li key={i}>
                “{n.note}” <span className="text-muted-foreground">· {n.company}, {n.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
