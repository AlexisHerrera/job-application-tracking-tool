import { LogOut, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CampaignPicker } from "@/components/CampaignPicker";
import { canSignOut, signOut } from "@/lib/auth";
import { ScanButton } from "./ScanButton";
import { SidebarNav } from "./SidebarNav";
import { ThemeSwitch } from "./ThemeSwitch";

export function Sidebar({ inbox, onNavigate }: { inbox: number; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2 px-2 pt-1 font-semibold tracking-tight">
        <span className="grid size-6 place-items-center rounded-md bg-primary text-xs text-primary-foreground">JT</span>
        Job Tracker
      </Link>
      <CampaignPicker className="w-full" />
      <Button asChild size="sm" className="justify-start">
        <Link to="/add" onClick={onNavigate}><Plus /> New application</Link>
      </Button>
      <SidebarNav inbox={inbox} onNavigate={onNavigate} />
      <div className="mt-auto space-y-3 px-1">
        <ScanButton />
        <ThemeSwitch />
        {canSignOut() && (
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => void signOut()}>
            <LogOut /> Sign out
          </Button>
        )}
      </div>
    </div>
  );
}
