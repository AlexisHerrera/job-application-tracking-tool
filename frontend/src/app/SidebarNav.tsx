import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { NAV, type NavAlert, type NavCount } from "./nav";
import { SidebarNavItem } from "./SidebarNavItem";

/** The pages in labelled groups: Discover, Apply and Track. `alerts` holds what each dot says. */
export function SidebarNav({ counts, alerts, onNavigate }: { counts: Record<NavCount, number>; alerts: Record<NavAlert, string | null>; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {NAV.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="flex h-6 items-center justify-between px-2">
            <h2 className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{group.label}</h2>
            {group.add && (
              <Link
                to={group.add.to}
                onClick={onNavigate}
                title={group.add.label}
                aria-label={group.add.label}
                className="-mr-1 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Plus className="size-4" />
              </Link>
            )}
          </div>
          {group.items.map((item) => (
            <SidebarNavItem
              key={item.to}
              item={item}
              count={item.count ? counts[item.count] : 0}
              alert={item.alert ? alerts[item.alert] : null}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}
