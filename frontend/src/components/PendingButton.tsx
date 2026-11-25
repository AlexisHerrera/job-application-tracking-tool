import type { ComponentProps } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PendingButton({ pending, disabled, children, ...props }: ComponentProps<typeof Button> & { pending: boolean }) {
  return (
    <Button {...props} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
      {children}
    </Button>
  );
}
