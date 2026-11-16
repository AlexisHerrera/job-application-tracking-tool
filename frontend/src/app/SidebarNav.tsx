import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";

export function SidebarNav({ inbox, onNavigate }: { inbox: number; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end, count }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
            )
          }
        >
          <Icon className="size-4" />
          {label}
          {count === "inbox" && inbox > 0 && (
            <span className="ml-auto rounded-full bg-primary px-1.5 text-xs leading-5 font-medium text-primary-foreground tabular-nums">{inbox}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
