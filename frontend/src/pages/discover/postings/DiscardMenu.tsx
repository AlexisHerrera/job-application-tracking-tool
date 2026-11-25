import { ThumbsDown } from "lucide-react";
import type { DiscardReason } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MORE_DISCARD_REASONS, QUICK_DISCARD_REASONS } from "@/features/discovery/discardReasons";

/** "Not for me" in the list: pick why. */
export function DiscardMenu({ disabled, onPick }: { disabled: boolean; onPick: (reason: DiscardReason) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled}><ThumbsDown /> Discard</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>Why is it out?</DropdownMenuLabel>
        {QUICK_DISCARD_REASONS.map((r) => (
          <DropdownMenuItem key={r.value} title={r.hint} onSelect={() => onPick(r.value)}>
            <r.icon />
            <span>
              {r.label}
              {r.detail && <span className="block text-xs text-muted-foreground">{r.detail}</span>}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>More reasons</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-(--radix-dropdown-menu-content-available-height) w-56 overflow-y-auto">
            {MORE_DISCARD_REASONS.map((r) => (
              <DropdownMenuItem key={r.value} title={r.hint} onSelect={() => onPick(r.value)}><r.icon /> {r.label}</DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
