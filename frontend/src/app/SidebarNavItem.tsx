import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav";

/** One page in the sidebar, with its count or its alert dot. */
export function SidebarNavItem({ item, count, alert, onNavigate }: { item: NavItem; count: number; alert: string | null; onNavigate?: () => void }) {
  const { to, label, icon: Icon, end } = item;
  return (
    <NavLink
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
      {count > 0 && (
        <span className="ml-auto rounded-full bg-primary px-1.5 text-xs leading-5 font-medium text-primary-foreground tabular-nums">{count}</span>
      )}
      {alert && (
        <span className="ml-auto size-2 rounded-full bg-destructive" title={alert}>
          <span className="sr-only">{alert}</span>
        </span>
      )}
    </NavLink>
  );
}
