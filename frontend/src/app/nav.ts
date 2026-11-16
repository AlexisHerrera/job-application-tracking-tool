import { CalendarDays, CalendarRange, Inbox as InboxIcon, KanbanSquare, LayoutDashboard, Rss, Target, Telescope, type LucideIcon } from "lucide-react";

/** A number after the label. */
export type NavCount = "review" | "inbox";
/** A dot after the label: something there needs a look. */
export type NavAlert = "sources";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  count?: NavCount;
  alert?: NavAlert;
}

export interface NavGroup {
  label: string;
  /** A "+" on the group's header. */
  add?: { to: string; label: string };
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Discover",
    items: [
      { to: "/discover", label: "Review", icon: Telescope, end: true, count: "review" },
      { to: "/discover/sources", label: "Sources", icon: Rss, alert: "sources" },
      { to: "/discover/criteria", label: "Criteria", icon: Target },
    ],
  },
  {
    label: "Track",
    add: { to: "/add", label: "New application" },
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/applications", label: "Applications", icon: KanbanSquare },
      { to: "/interviews", label: "Interviews", icon: CalendarDays },
      { to: "/calendar", label: "Calendar", icon: CalendarRange },
      { to: "/inbox", label: "Inbox", icon: InboxIcon, count: "inbox" },
    ],
  },
];
