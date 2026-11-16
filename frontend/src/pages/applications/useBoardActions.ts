import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { api, errorText, type Application, type Stage } from "@/api";
import { useRefresh } from "@/lib/refresh";
import { STATUS_META } from "@/lib/status";

/** Moving a card to another stage and confirming a review. Both update the page's data before the
 * server answers; a failed move puts it back. */
export function useBoardActions(data: Application[] | null, setData: Dispatch<SetStateAction<Application[] | null>>) {
  const { bump } = useRefresh();

  async function move(app: Application, stage: Stage) {
    const before = data;
    setData((data ?? []).map((a) => (a.id === app.id ? { ...a, status: stage, current_stage: stage } : a)));
    try {
      await api.changeStage(app.id, { stage });
      toast.success(`${app.company} → ${STATUS_META[stage].label}`, {
        action: {
          label: "Undo",
          onClick: () => void api.changeStage(app.id, { stage: app.current_stage, note: "undo" }).then(bump, (e) => toast.error(errorText(e))),
        },
      });
    } catch (e) {
      setData(before);
      toast.error(errorText(e));
    }
    bump();
  }

  async function confirm(app: Application) {
    setData((data ?? []).map((a) => (a.id === app.id ? { ...a, needs_review: false } : a)));
    try {
      await api.markReviewed(app.id);
      toast.success(`${app.company} confirmed`);
    } catch (e) {
      toast.error(errorText(e));
    }
    bump();
  }

  return { move, confirm };
}
