import { useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { type Application, type Stage } from "@/api/applications";
import { useRefresh } from "@/lib/refresh";
import { STATUS_META } from "@/lib/status";

/** Keep concurrent moves on different cards independent, including when one fails. */
export function useBoardActions(_data: Application[] | null, setData: Dispatch<SetStateAction<Application[] | null>>) {
  const { bump } = useRefresh();
  const active = useRef(new Set<string>());

  function patch(id: string, change: Partial<Application>) {
    setData((items) => items?.map((a) => a.id === id ? { ...a, ...change } : a) ?? null);
  }

  async function run(id: string, work: () => Promise<void>) {
    if (active.current.has(id)) return;
    active.current.add(id);
    try {
      await work();
    } finally {
      active.current.delete(id);
      if (!active.current.size) bump();
    }
  }

  const move = (app: Application, stage: Stage, undo = false) => run(app.id, async () => {
    patch(app.id, { status: stage, current_stage: stage });
    try {
      const saved = await api.changeStage(app.id, { stage, ...(undo ? { note: "undo" } : {}) });
      patch(app.id, saved);
      if (!undo) {
        toast.success(`${app.company} → ${STATUS_META[stage].label}`, {
          action: { label: "Undo", onClick: () => void move(saved, app.current_stage, true) },
        });
      }
    } catch (e) {
      patch(app.id, { status: app.status, current_stage: app.current_stage });
      toast.error(errorText(e));
    }
  });

  const confirm = (app: Application) => run(app.id, async () => {
    patch(app.id, { needs_review: false });
    try {
      await api.markReviewed(app.id);
      toast.success(`${app.company} confirmed`);
    } catch (e) {
      patch(app.id, { needs_review: app.needs_review });
      toast.error(errorText(e));
    }
  });

  return { move, confirm };
}
