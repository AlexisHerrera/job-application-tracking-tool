import { Settings } from "lucide-react";
import { Link, useMatch } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CampaignPicker } from "@/components/CampaignPicker";
import { useCampaign } from "@/lib/campaign";
import { cn } from "@/lib/utils";

/** The campaign picker, and a gear to the Campaigns page. With no campaign yet the picker shows
 * nothing, so the gear says what it opens. */
export function SidebarCampaignPicker({ onNavigate }: { onNavigate?: () => void }) {
  const none = useCampaign().campaigns.length === 0;
  const active = useMatch("/campaigns") !== null;
  return (
    <div className="flex items-center gap-1">
      <CampaignPicker className="w-auto min-w-0 flex-1" />
      <Button
        asChild
        variant="ghost"
        size={none ? "sm" : "icon-sm"}
        className={cn("text-muted-foreground", none && "flex-1 justify-start", active && "bg-sidebar-accent text-sidebar-accent-foreground")}
      >
        <Link to="/campaigns" onClick={onNavigate} title="Campaigns" aria-label={none ? undefined : "Campaigns"}>
          <Settings />
          {none && "Campaigns"}
        </Link>
      </Button>
    </div>
  );
}
