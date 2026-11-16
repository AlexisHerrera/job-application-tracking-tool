import { useRef, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { Application, Stage, Status } from "@/api/applications";
import { STATUS_ORDER, isStage } from "@/lib/status";
import { BoardCard } from "./BoardCard";
import { BoardCardBody } from "./BoardCardBody";
import { BoardColumn } from "./BoardColumn";
import { byUrgency, collision } from "./boardSort";
import { useCollapsedColumns } from "./useCollapsedColumns";

export function Board({
  apps, onOpen, onMove, onConfirm,
}: {
  apps: Application[];
  onOpen: (id: string) => void;
  onMove: (app: Application, stage: Stage) => void;
  onConfirm: (app: Application) => void;
}) {
  const { collapsed, toggle } = useCollapsedColumns();
  const [dragging, setDragging] = useState<Application | null>(null);
  const dropped = useRef(false);
  // Some browsers fire a click on the card right after a drop; that must not open it.
  const open = (id: string) => {
    if (!dropped.current) onOpen(id);
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a short press is still a click
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  function end(e: DragEndEvent) {
    setDragging(null);
    dropped.current = true;
    setTimeout(() => (dropped.current = false), 0);
    const app = e.active.data.current?.app as Application | undefined;
    const target = e.over?.id as Status | undefined;
    if (!app || !target || target === app.status || !isStage(target)) return;
    onMove(app, target);
  }

  const byStatus = new Map<Status, Application[]>(STATUS_ORDER.map((s) => [s, []]));
  for (const a of apps) byStatus.get(a.status)?.push(a);
  for (const list of byStatus.values()) list.sort(byUrgency);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={(e) => setDragging((e.active.data.current?.app as Application) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={end}
    >
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        {STATUS_ORDER.map((s) => (
          <BoardColumn key={s} status={s} count={byStatus.get(s)!.length} collapsed={collapsed.has(s)} onToggle={() => toggle(s)} dragging={dragging}>
            {byStatus.get(s)!.map((a) => <BoardCard key={a.id} app={a} onOpen={open} onConfirm={onConfirm} />)}
          </BoardColumn>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && <BoardCardBody app={dragging} className="rotate-2 cursor-grabbing shadow-lg" />}
      </DragOverlay>
    </DndContext>
  );
}
