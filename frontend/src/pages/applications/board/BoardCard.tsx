import type { KeyboardEvent } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Application } from "@/api/applications";
import { cn } from "@/lib/utils";
import { BoardCardBody } from "./BoardCardBody";

export function BoardCard({ app, onOpen, onConfirm }: { app: Application; onOpen: (id: string) => void; onConfirm: (app: Application) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id, data: { app } });
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") onOpen(app.id);
    else listeners?.onKeyDown?.(e);
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(app.id)}
      aria-roledescription="Draggable application. Space to pick up, Enter to open"
      className={cn("rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", isDragging && "opacity-40")}
    >
      <BoardCardBody app={app} onConfirm={onConfirm} />
    </div>
  );
}
