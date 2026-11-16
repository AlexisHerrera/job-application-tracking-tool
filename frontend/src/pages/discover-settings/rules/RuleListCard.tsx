import { useState } from "react";
import type { RuleListHits } from "@/api/discoverySettings";
import { timeAgo } from "@/lib/format";
import { ChipListInput } from "@/pages/discover-settings/ChipListInput";
import { SettingsCard } from "@/pages/discover-settings/SettingsCard";

/** "Hide company" marks on the block list. */
function addedMark(added: { name: string; at: string }[]) {
  const when = new Map(added.map((x) => [x.name.toLowerCase(), x.at]));
  return function Mark(v: string) {
    const at = when.get(v.toLowerCase());
    return at ? <span className="text-[10px] text-muted-foreground" title={`Added with “Hide company” ${timeAgo(at)}`}>hidden from a card</span> : null;
  };
}

/** One rule list: its entries as chips, how many postings each hid, and the list's total. */
export function RuleListCard({ label, hint, placeholder, values, onChange, hits, added }: { label: string; hint: string; placeholder: string; values: string[]; onChange: (v: string[]) => void; hits?: RuleListHits; added?: { name: string; at: string }[] }) {
  const [byCount, setByCount] = useState(false);
  const perEntry = hits && Object.keys(hits.entries).length > 0 ? hits.entries : undefined;
  return (
    <SettingsCard
      title={label}
      hint={hint}
      aside={
        <>
          <span className="tabular-nums">{values.length} entr{values.length === 1 ? "y" : "ies"}</span>
          {hits && <span className="tabular-nums font-medium text-foreground">· hid {hits.total.toLocaleString()}</span>}
        </>
      }
    >
      <ChipListInput label={label} values={values} onChange={onChange} placeholder={`Find or add, e.g. ${placeholder}`} counts={perEntry} sortByCount={byCount} mark={added ? addedMark(added) : undefined} />
      {perEntry && values.length > 1 && (
        <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setByCount(!byCount)}>
          {byCount ? "Show in list order" : "Most hidden first"}
        </button>
      )}
    </SettingsCard>
  );
}
