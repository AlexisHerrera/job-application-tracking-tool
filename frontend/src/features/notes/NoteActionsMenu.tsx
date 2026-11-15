import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NoteActionsMenu({ onAdd, onDelete, canDelete }: { onAdd: () => void; onDelete: () => void; canDelete: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Note actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onAdd}><Plus /> Add another note</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={!canDelete} onSelect={onDelete}><Trash2 /> Delete this note</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
