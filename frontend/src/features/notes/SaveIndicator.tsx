import { cn } from "@/lib/utils";
import type { SaveStatus } from "./useAutosave";

export function SaveIndicator({ status }: { status: SaveStatus }) {
  const text = { idle: "", saving: "Saving…", saved: "Saved", error: "Not saved" }[status];
  return (
    <span aria-live="polite" className={cn("text-xs tabular-nums text-muted-foreground", status === "error" && "text-destructive")}>
      {text}
    </span>
  );
}
