import {
  AtSign, Banknote, Briefcase, CalendarDays, Gift, Hash, Layers, Link2, MapPin, MousePointerClick, PenLine, Radio, Star,
  TrendingUp,
} from "lucide-react";
import { dayToIso, daysAgo, fmtDate, isoToDay, label, type ApplicationDetail, type Stage } from "@/api";
import { APPLICATION_SENIORITY, CHANNELS } from "@/lib/applicationOptions";
import type { Patch } from "@/features/application/ApplicationView/patch";
import { EditableText } from "./EditableText";
import { PropertyRow } from "./PropertyRow";
import { SalaryField } from "./SalaryField";
import { SelectField } from "./SelectField";

export function PropertiesList({ app, save, setStage }: { app: ApplicationDetail; save: (p: Patch) => Promise<void>; setStage: (s: Stage, round?: number | null) => Promise<void> }) {
  const domains = app.aliases.filter((a) => a.kind === "domain").map((a) => a.value);
  const others = app.aliases.filter((a) => a.kind !== "domain").map((a) => a.value);
  return (
    <div className="space-y-0.5">
      <PropertyRow icon={CalendarDays} label="Applied">
        <EditableText
          type="date"
          value={isoToDay(app.applied_at)}
          display={app.applied_at ? <>{fmtDate(app.applied_at)} <span className="text-muted-foreground">· {daysAgo(app.applied_at)}</span></> : null}
          onSave={(v) => save({ applied_at: v ? dayToIso(v) : null })}
        />
      </PropertyRow>
      <PropertyRow icon={TrendingUp} label="Progress">
        <div className="flex h-8 items-center gap-2 px-2 text-sm">
          furthest: {label(app.max_stage_reached)}
          {app.last_event_at && <span className="text-muted-foreground">· last activity {daysAgo(app.last_event_at)}</span>}
        </div>
      </PropertyRow>
      <PropertyRow icon={Hash} label="Round">
        <EditableText
          type="number"
          value={app.current_round?.toString() ?? ""}
          placeholder="—"
          onSave={(v) => setStage(app.current_stage, v ? Number(v) : null)}
        />
      </PropertyRow>
      <PropertyRow icon={Banknote} label="Salary">
        <SalaryField app={app} save={save} />
      </PropertyRow>
      <PropertyRow icon={Gift} label="Benefits">
        <EditableText multiline value={app.benefits ?? ""} placeholder="Equity, bonus, PTO…" onSave={(v) => save({ benefits: v })} />
      </PropertyRow>
      <PropertyRow icon={Radio} label="Channel">
        <SelectField value={app.source_channel ?? ""} options={CHANNELS} onSave={(v) => save({ source_channel: v })} />
      </PropertyRow>
      <PropertyRow icon={MousePointerClick} label="ATS">
        <EditableText value={app.source_ats ?? ""} placeholder="ashby, lever…" onSave={(v) => save({ source_ats: v })} />
      </PropertyRow>
      <PropertyRow icon={Star} label="Seniority">
        <SelectField value={app.seniority ?? ""} options={APPLICATION_SENIORITY} onSave={(v) => save({ seniority: v })} />
      </PropertyRow>
      <PropertyRow icon={Layers} label="Stack">
        <EditableText
          value={app.stack.join(", ")}
          display={app.stack.length ? (
            <span className="flex flex-wrap gap-1">{app.stack.map((s) => <span key={s} className="rounded bg-muted px-1.5 text-xs leading-5">{s}</span>)}</span>
          ) : null}
          placeholder="python, aws, react"
          onSave={(v) => save({ stack: (v ?? "").split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </PropertyRow>
      <PropertyRow icon={MapPin} label="Location">
        <EditableText value={app.location ?? ""} placeholder="Remote (LATAM)" onSave={(v) => save({ location: v })} />
      </PropertyRow>
      <PropertyRow icon={Link2} label="Posting">
        <EditableText
          type="url"
          value={app.job_url ?? ""}
          display={app.job_url ? <span className="block truncate text-primary underline-offset-4">{app.job_url}</span> : null}
          placeholder="https://…"
          onSave={(v) => save({ job_url: v })}
        />
      </PropertyRow>
      <PropertyRow icon={AtSign} label="Mail from">
        <div className="space-y-1">
          {(domains.length > 0 || others.length > 0) && (
            <div className="flex flex-wrap gap-1 px-2 pt-1.5">
              {[...domains, ...others].map((v) => <span key={v} className="rounded bg-muted px-1.5 text-xs leading-5">{v}</span>)}
            </div>
          )}
          <EditableText value="" placeholder="+ add company email domain" onSave={(v) => (v ? save({ company_domain: v }) : Promise.resolve())} />
        </div>
      </PropertyRow>
      <PropertyRow icon={PenLine} label="Notes">
        <EditableText multiline value={app.notes ?? ""} onSave={(v) => save({ notes: v })} />
      </PropertyRow>
      <PropertyRow icon={Briefcase} label="Description">
        <EditableText multiline clamp value={app.job_description ?? ""} placeholder="Paste the job description" onSave={(v) => save({ job_description: v })} />
      </PropertyRow>
    </div>
  );
}
