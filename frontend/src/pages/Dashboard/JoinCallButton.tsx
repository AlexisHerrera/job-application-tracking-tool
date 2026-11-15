import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Interview } from "@/api";

export function JoinCallButton({ i, size = "icon-xs" }: { i: Interview; size?: "icon-xs" | "sm" }) {
  if (!i.meeting_url) return null;
  return (
    <Button asChild variant={size === "sm" ? "default" : "ghost"} size={size} aria-label={`Join the ${i.company ?? ""} call`}>
      <a href={i.meeting_url} target="_blank" rel="noreferrer"><Video />{size === "sm" && " Join call"}</a>
    </Button>
  );
}
