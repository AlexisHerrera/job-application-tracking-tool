import type { ReactNode } from "react";
import { Check, Sparkles, Star } from "lucide-react";
import { label } from "@/lib/format";
import { type Posting } from "@/api/discovery";
import { cn } from "@/lib/utils";
import { DISCARD_LABEL } from "@/pages/discover/discardReasons";
import { COMPANY_SIZE, DROP_LABEL, SECTOR, WORK_MODE } from "@/pages/discover/constants";

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-xs whitespace-nowrap", className)}>{children}</span>;
}

export function PostingChips({ p }: { p: Posting }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {p.drop_reason && <Chip className="border-destructive/30 text-destructive">hidden: {DROP_LABEL[p.drop_reason] ?? p.drop_reason}</Chip>}
      {p.status === "dismissed" && <Chip className="border-rose-500/40">discarded{p.discard_reason ? `: ${DISCARD_LABEL[p.discard_reason].toLowerCase()}` : ""}</Chip>}
      {p.status === "applied" && <Chip className="border-emerald-500/40"><Check className="mr-1 size-3" /> applied</Chip>}
      {p.status === "interested" && <Chip className="border-amber-500/40"><Star className="mr-1 size-3" /> saved for later</Chip>}
      {p.in_tracker && p.status !== "applied" && <Chip>company already in your tracker</Chip>}
      {p.ai_related && <Chip><Sparkles className="mr-1 size-3" /> AI</Chip>}
      {p.location_fit && p.location_fit !== "unclear" && <Chip>location: {p.location_fit === "yes" ? "fits" : "doesn't fit"}</Chip>}
      {p.seniority && p.seniority !== "unclear" && <Chip>{label(p.seniority)}</Chip>}
      {p.years_required != null && <Chip>{p.years_required}+ years</Chip>}
      {p.employer_kind && p.employer_kind !== "direct" && p.employer_kind !== "unclear" && <Chip>{p.employer_kind}</Chip>}
      {p.work_mode && p.work_mode !== "unclear" && <Chip>{WORK_MODE[p.work_mode] ?? p.work_mode}</Chip>}
      {p.company_size && p.company_size !== "unclear" && <Chip>{COMPANY_SIZE[p.company_size] ?? p.company_size}</Chip>}
      {p.sector && p.sector !== "unclear" && <Chip>{SECTOR[p.sector] ?? p.sector}</Chip>}
    </div>
  );
}
