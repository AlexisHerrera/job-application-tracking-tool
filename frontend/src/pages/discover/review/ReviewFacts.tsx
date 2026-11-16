import { Banknote, Building2, Factory, GraduationCap, Handshake, Laptop, MapPin } from "lucide-react";
import type { Posting } from "@/api/discovery";
import { COMPANY_SIZE, EMPLOYER, SECTOR, SENIORITY, WORK_MODE } from "@/features/discovery/postingLabels";
import { salaryOf, usdSalary } from "@/pages/discover/format";
import { FactTile, type FactTone } from "./FactTile";

const known = (v: string | null) => (v && v !== "unclear" ? v : null);

/** What decides a posting, as tiles: green fits, red doesn't, amber means the posting doesn't say. */
export function ReviewFacts({ p }: { p: Posting }) {
  const fit: Record<string, [string, FactTone]> = { yes: ["You can be hired here", "good"], no: ["Rules out your location", "bad"], unclear: ["Doesn't say if you qualify", "warn"] };
  const [fitText, fitTone] = fit[p.location_fit ?? ""] ?? [null, "plain"];
  const salary = salaryOf(p);
  const usd = usdSalary(p);
  const mode = known(p.work_mode);
  const seniority = known(p.seniority);
  const employer = known(p.employer_kind);
  const size = known(p.company_size);
  const sector = known(p.sector);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <FactTile icon={<MapPin />} label="Location" value={p.location ?? "Not stated"} detail={fitText} tone={fitTone} />
      <FactTile icon={<Laptop />} label="Work mode" value={mode ? (WORK_MODE[mode] ?? mode) : "Not stated"} tone={mode === "remote" ? "good" : mode ? "warn" : "plain"} />
      <FactTile icon={<Banknote />} label="Salary" value={salary ?? usd ?? "Not stated"} detail={salary && usd ? usd : null} tone={salary || usd ? "info" : "plain"} />
      <FactTile
        icon={<GraduationCap />}
        label="Level"
        value={seniority ? (SENIORITY[seniority] ?? seniority) : "Not stated"}
        detail={p.years_required != null ? `${p.years_required}+ years asked` : null}
        tone={seniority === "staff_plus" ? "warn" : "plain"}
      />
      <FactTile icon={<Building2 />} label="Company size" value={size ? (COMPANY_SIZE[size] ?? size) : "Unknown"} />
      <FactTile icon={<Factory />} label="Sector" value={sector ? (SECTOR[sector] ?? sector) : "Unknown"} detail={p.ai_related ? "AI work in the role" : null} tone={p.ai_related ? "info" : "plain"} />
      {employer && employer !== "direct" && <FactTile icon={<Handshake />} label="Posted by" value={EMPLOYER[employer] ?? employer} detail="Not the company you'd work for" tone="warn" />}
    </div>
  );
}
