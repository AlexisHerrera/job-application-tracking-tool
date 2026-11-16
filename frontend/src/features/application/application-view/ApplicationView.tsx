import { Mail, NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { api, errorText, type Stage } from "@/api";
import { Loading } from "@/components/common";
import { STATUS_META } from "@/lib/status";
import { useRefresh } from "@/lib/refresh";
import { useAsync } from "@/lib/useAsync";
import { ActivitySection } from "./activity/ActivitySection";
import { ApplicationHeader } from "./ApplicationHeader";
import { DeleteApplication } from "./DeleteApplication";
import { InterviewsAndNotes } from "./interviews/InterviewsAndNotes";
import { PasteMoreInfo } from "./PasteMoreInfo";
import type { Patch } from "./patch";
import { PropertiesList } from "./properties/PropertiesList";
import { Section } from "./Section";

export function ApplicationView({ id, inSheet = false, onDeleted }: { id: string; inSheet?: boolean; onDeleted?: () => void }) {
  const { bump } = useRefresh();
  const { data: app, error, loading } = useAsync(() => api.application(id), [id]);
  if (!app) return <div className="p-6"><Loading error={error} loading={loading} /></div>;

  async function save(patch: Patch) {
    try {
      await api.updateApplication(id, patch);
      bump();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function setStage(stage: Stage, round?: number | null) {
    try {
      await api.changeStage(id, { stage, round });
      toast.success(round ? `Round ${round}` : `Moved to ${STATUS_META[stage].label}`);
      bump();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <div className="flex flex-col">
      <ApplicationHeader app={app} inSheet={inSheet} save={save} setStage={setStage} onReviewed={bump} />

      <div className={cn("space-y-8 py-5", inSheet && "px-6")}>
        <PropertiesList app={app} save={save} setStage={setStage} />

        <Section icon={Mail} title="Emails & activity">
          <ActivitySection app={app} onDone={bump} />
        </Section>

        <Section icon={NotebookPen} title="Interviews & notes">
          <InterviewsAndNotes app={app} onDone={bump} />
        </Section>

        <PasteMoreInfo applicationId={app.id} onApplied={bump} />

        <Separator />
        <DeleteApplication app={app} onDeleted={() => { bump(); onDeleted?.(); }} />
      </div>
    </div>
  );
}
