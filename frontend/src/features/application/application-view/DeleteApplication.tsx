import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { type Application } from "@/api/applications";

export function DeleteApplication({ app, onDeleted }: { app: Application; onDeleted: () => void }) {
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
      <Button
        variant="destructive"
        size="sm"
        onClick={async () => {
          await api.deleteApplication(app.id);
          toast.success(`Deleted ${app.company}`);
          onDeleted();
        }}
      >
        Yes, delete
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
    </div>
  );
}
