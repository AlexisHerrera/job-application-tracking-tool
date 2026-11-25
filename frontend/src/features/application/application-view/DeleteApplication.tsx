import { PendingButton } from "@/components/PendingButton";
import { errorText } from "@/lib/errors";
import { usePending } from "@/lib/usePending";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { type Application } from "@/api/applications";

export function DeleteApplication({ app, onDeleted }: { app: Application; onDeleted: () => void }) {
  const { pending, run: runPending } = usePending<"delete">();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirm(true)}>
        <Trash2 /> Delete application
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      Delete {app.company}? Its emails go back to the inbox.
      <PendingButton pending={pending !== null}
        variant="destructive"
        size="sm"
        onClick={() => runPending("delete", async () => {
          try {
            await api.deleteApplication(app.id);
            toast.success(`Deleted ${app.company}`);
            onDeleted();
          } catch (e) {
            toast.error(errorText(e));
          }
        })}
      >
        Yes, delete
      </PendingButton>
      <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => setConfirm(false)}>Cancel</Button>
    </div>
  );
}
