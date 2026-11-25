import { PendingButton } from "@/components/PendingButton";
import { usePending } from "@/lib/usePending";
import { Telescope } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { errorText } from "@/lib/errors";
import { Empty } from "@/components/common";

/** "No saved searches yet" + Load the defaults. */
export function SeedEmptyState({ onSeeded }: { onSeeded: () => void }) {
  const { pending, run: runPending } = usePending<"seed">();
  return (
    <Empty icon={<Telescope className="size-8" />}>
      <p>No saved searches yet.</p>
      <PendingButton pending={pending !== null}
        size="sm"
        onClick={() => runPending("seed", async () => {
          try {
            await api.seedDiscovery();
            toast.success("Loaded the default searches, criteria and company watchlist. Review them, then run.");
            onSeeded();
          } catch (e) {
            toast.error(errorText(e));
          }
        })}
      >
        Load the defaults
      </PendingButton>
    </Empty>
  );
}
