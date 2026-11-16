import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { fmtDate, label, type PasteRecord } from "@/api";
import { KIND_CLASS, KIND_TEXT, NO_COMPANY, defaults, show, type Selection } from "./paste";

/** One position read from the text: which application it goes to, and the changes to pick from. */
export function PasteRecordCard({ rec, index: i, selection: s, onChange: update }: {
  rec: PasteRecord;
  index: number;
  selection: Selection;
  onChange: (patch: Partial<Selection>) => void;
}) {
  const opt = rec.options[s.option];
  const isNew = opt.application_id === null;
  const hasRole = opt.changes.some((c) => c.field === "role_title" && s.fields.has(c.field));
  const toggle = (field: string, on: boolean) => {
    const fields = new Set(s.fields);
    if (on) fields.add(field);
    else fields.delete(field);
    update({ fields });
  };
  return (
    <div className={cn("space-y-3 rounded-lg border p-4", s.skip && "opacity-50")}>
      <div className="flex flex-wrap items-center gap-3">
        {rec.company ? <strong>{rec.company}</strong> : <strong className="text-amber-700 dark:text-amber-400">{NO_COMPANY}</strong>}
        {rec.options.length > 1 ? (
          <NativeSelect size="sm" value={s.option} aria-label="Apply to" onChange={(e) => {
            const option = Number(e.target.value);
            update({ option, ...defaults(rec.options[option]) });
          }}>
            {rec.options.map((o, j) => <NativeSelectOption key={j} value={j}>{o.label}</NativeSelectOption>)}
          </NativeSelect>
        ) : <span className="text-sm text-muted-foreground">{opt.label}</span>}
        <Label className="ml-auto text-sm font-normal">
          <Checkbox checked={s.skip} onCheckedChange={(v) => update({ skip: v === true })} /> skip
        </Label>
      </div>
      {rec.evidence && <div className="text-sm text-muted-foreground italic">“{rec.evidence}”</div>}
      {rec.salary_note && <div className="text-sm text-muted-foreground">Salary {rec.salary_note}.</div>}
      {!s.skip && (
        <>
          {opt.changes.length === 0 && !opt.stage_change && <p className="text-sm text-muted-foreground">Nothing new for this application.</p>}
          {isNew && !rec.company && (
            <div className="space-y-1.5">
              <Label htmlFor={`paste-company-${i}`}>Company (required)</Label>
              <Input id={`paste-company-${i}`} value={s.company} onChange={(e) => update({ company: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                The text doesn't name the hiring company (an agency post?). Type the employer, not the agency.
              </p>
            </div>
          )}
          {isNew && !hasRole && (
            <div className="space-y-1.5">
              <Label htmlFor={`paste-role-${i}`}>Role (required)</Label>
              <Input id={`paste-role-${i}`} value={s.role} onChange={(e) => update({ role: e.target.value })} />
            </div>
          )}
          <div className="divide-y rounded-md border">
            {opt.changes.map((c) => (
              <label key={c.field} className={cn("grid cursor-pointer grid-cols-[auto_8rem_1fr] items-start gap-3 p-2.5 text-sm hover:bg-muted/50", c.kind === "change" && "bg-amber-500/5")}>
                <Checkbox checked={s.fields.has(c.field)} onCheckedChange={(v) => toggle(c.field, v === true)} className="mt-0.5" />
                <span>{c.label}<span className={cn("block text-xs", KIND_CLASS[c.kind])}>{KIND_TEXT[c.kind]}</span></span>
                <span className="min-w-0 break-words">
                  {c.kind !== "fill" && <span className="block text-muted-foreground line-through">{show(c.field, c.current)}</span>}
                  {show(c.field, c.proposed)}
                </span>
              </label>
            ))}
            {opt.stage_change && (
              <label className={cn("grid cursor-pointer grid-cols-[auto_8rem_1fr] items-start gap-3 p-2.5 text-sm hover:bg-muted/50", opt.stage_change.kind === "change" && "bg-amber-500/5")}>
                <Checkbox checked={s.stage} onCheckedChange={(v) => update({ stage: v === true })} className="mt-0.5" />
                <span>Stage<span className={cn("block text-xs", KIND_CLASS[opt.stage_change.kind])}>{KIND_TEXT[opt.stage_change.kind]}</span></span>
                <span>
                  {opt.stage_change.current && <span className="block text-muted-foreground line-through">{label(opt.stage_change.current)}</span>}
                  {label(opt.stage_change.proposed)}{opt.stage_change.at ? ` (on ${fmtDate(opt.stage_change.at)})` : ""}
                </span>
              </label>
            )}
          </div>
        </>
      )}
    </div>
  );
}
