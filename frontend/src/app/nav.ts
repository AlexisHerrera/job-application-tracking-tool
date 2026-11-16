import { CalendarDays, CalendarRange, Flag, Inbox as InboxIcon, Telescope, KanbanSquare, LayoutDashboard } from "lucide-react";

export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/applications", label: "Applications", icon: KanbanSquare },
  { to: "/interviews", label: "Interviews", icon: CalendarDays },
  { to: "/calendar", label: "Calendar", icon: CalendarRange },
  { to: "/inbox", label: "Inbox", icon: InboxIcon, count: "inbox" as const },
  { to: "/discover", label: "Discover", icon: Telescope },
  { to: "/campaigns", label: "Campaigns", icon: Flag },
];
