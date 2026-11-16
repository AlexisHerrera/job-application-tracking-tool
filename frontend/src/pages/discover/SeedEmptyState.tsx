import { Telescope } from "lucide-react";
import { toast } from "sonner";
import { api, errorText } from "@/api";
import { Empty } from "@/components/common";
import { Button } from "@/components/ui/button";

/** "No saved searches yet" + Load the defaults. */
export function SeedEmptyState({ onSeeded }: { onSeeded: () => void }) {
  return (
    <Empty icon={<Telescope className="size-8" />}>
      <p>No saved searches yet.</p>
      <Button
        size="sm"
        onClick={async () => {
          try {
            await api.seedDiscovery();
            toast.success("Loaded the default searches, criteria and company watchlist. Review them, then run.");
            onSeeded();
          } catch (e) {
            toast.error(errorText(e));
          }
        }}
      >
        Load the defaults
      </Button>
    </Empty>
  );
}
