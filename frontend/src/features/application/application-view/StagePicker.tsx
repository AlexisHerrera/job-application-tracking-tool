import { ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STAGES, type Application, type Stage } from "@/api/applications";
import { StatusBadge, StatusDot } from "@/components/common";
import { STATUS_META } from "@/lib/status";

export function StagePicker({ app, onPick }: { app: Application; onPick: (s: Stage) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Change stage">
          <StatusBadge status={app.status} />
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STAGES.map((s) => (
          <DropdownMenuItem key={s} disabled={s === app.current_stage && app.status !== "ghosted"} onSelect={() => onPick(s)}>
            <StatusDot status={s} /> {STATUS_META[s].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
