import { cn } from "@/lib/utils";

export function OutcomeSwatch({ color, track }: { color?: string; track?: boolean }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", track && "bg-muted ring-1 ring-border ring-inset")}
      style={track ? undefined : { background: color }}
    />
  );
}
