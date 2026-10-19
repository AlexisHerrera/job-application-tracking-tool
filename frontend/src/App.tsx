import { useState } from "react";
import { Flag, Inbox as InboxIcon, KanbanSquare, LayoutDashboard, Menu, Monitor, Moon, Plus, Sun } from "lucide-react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "./api";
import { CampaignPicker } from "./campaign";
import AddApplication from "./pages/AddApplication";
import ApplicationPage from "./pages/ApplicationPage";
import Applications from "./pages/Applications";
import Campaigns from "./pages/Campaigns";
import DashboardPage from "./pages/Dashboard";
import Inbox from "./pages/Inbox";
import { useTheme, type Theme } from "./lib/theme";
import { useAsync } from "./useAsync";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const counts = useAsync(api.dashboard).data;

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <Sidebar inbox={counts?.unassigned ?? 0} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar inbox={counts?.unassigned ?? 0} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon-sm" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu /></Button>
          <span className="font-semibold">Job Tracker</span>
          <CampaignPicker className="ml-auto max-w-40" />
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-8">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/applications" element={<Applications />} />
            <Route path="/applications/:id" element={<ApplicationPage />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/add" element={<AddApplication />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="*" element={<p className="text-muted-foreground">Not found.</p>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/applications", label: "Applications", icon: KanbanSquare },
  { to: "/inbox", label: "Inbox", icon: InboxIcon, count: "inbox" as const },
  { to: "/campaigns", label: "Campaigns", icon: Flag },
];

function Sidebar({ inbox, onNavigate }: { inbox: number; onNavigate?: () => void }) {
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
      <div className="mt-auto px-1">
        <ThemeSwitch />
      </div>
    </div>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={theme} onValueChange={(v) => v && setTheme(v as Theme)} aria-label="Theme">
      <ToggleGroupItem value="light" aria-label="Light"><Sun /></ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark"><Moon /></ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System"><Monitor /></ToggleGroupItem>
    </ToggleGroup>
  );
}
