import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampaignPicker } from "@/components/CampaignPicker";

export function MobileHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur md:hidden">
      <Button variant="ghost" size="icon-sm" aria-label="Open menu" onClick={onOpenMenu}><Menu /></Button>
      <span className="font-semibold">Job Tracker</span>
      <CampaignPicker className="ml-auto max-w-40" />
    </header>
  );
}
