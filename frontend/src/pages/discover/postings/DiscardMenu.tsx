import { ThumbsDown } from "lucide-react";
import type { DiscardReason } from "@/api/discovery";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DISCARD_REASONS } from "@/pages/discover/discardReasons";

/** "Not for me" in the list: pick why. */
export function DiscardMenu({ disabled, onPick }: { disabled: boolean; onPick: (reason: DiscardReason) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled}><ThumbsDown /> Discard</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>Why is it out?</DropdownMenuLabel>
        {DISCARD_REASONS.map((r) => (
          <DropdownMenuItem key={r.value} title={r.hint} onSelect={() => onPick(r.value)}><r.icon /> {r.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
