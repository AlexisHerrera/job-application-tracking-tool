import { LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useDiscoveryStatus } from "@/features/discovery/discoveryStatus";
import { canSignOut, signOut } from "@/lib/auth";
import { JobSourcesStatus } from "./JobSourcesStatus";
import { MailStatus } from "./MailStatus";
import { runErrors } from "./runErrors";
import { SidebarCampaignPicker } from "./SidebarCampaignPicker";
import { SidebarNav } from "./SidebarNav";
import { ThemeSwitch } from "./ThemeSwitch";

export function Sidebar({ inbox, onNavigate }: { inbox: number; onNavigate?: () => void }) {
  const { status } = useDiscoveryStatus();
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2 px-2 pt-1 font-semibold tracking-tight">
        <span className="grid size-6 place-items-center rounded-md bg-primary text-xs text-primary-foreground">JT</span>
        Job Tracker
      </Link>
      <SidebarCampaignPicker onNavigate={onNavigate} />
      <SidebarNav
        counts={{ review: status?.to_review ?? 0, inbox }}
        alerts={{ sources: runErrors(status?.last_run) }}
        onNavigate={onNavigate}
      />
      <div className="mt-auto space-y-3">
        <div className="space-y-0.5 border-t pt-2">
          <JobSourcesStatus onNavigate={onNavigate} />
          <MailStatus />
        </div>
        <div className="space-y-3 px-1">
          <ThemeSwitch />
          {canSignOut() && (
            <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => void signOut()}>
              <LogOut /> Sign out
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
