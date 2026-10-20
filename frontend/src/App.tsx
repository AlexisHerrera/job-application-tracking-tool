import { useState } from "react";
import { CalendarDays, Flag, Inbox as InboxIcon, KanbanSquare, LayoutDashboard, Menu, Monitor, Moon, Plus, RefreshCw, Sun } from "lucide-react";
import { toast } from "sonner";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, errorText, timeAgo, type CalendarSyncResult, type ScanResult } from "./api";
import { CampaignPicker } from "./campaign";
import AddApplication from "./pages/AddApplication";
import ApplicationPage from "./pages/ApplicationPage";
import Applications from "./pages/Applications";
import Campaigns from "./pages/Campaigns";
import DashboardPage from "./pages/Dashboard";
import Inbox from "./pages/Inbox";
import Interviews from "./pages/Interviews";
import { EditorDialog, EditorPage } from "./NotesEditor";
import { useRefresh } from "./lib/refresh";
import { useTheme, type Theme } from "./lib/theme";
import { useAsync } from "./useAsync";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const counts = useAsync(api.dashboard).data;

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <Sidebar inbox={(counts?.unassigned ?? 0) + (counts?.unassigned_interviews ?? 0)} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar inbox={(counts?.unassigned ?? 0) + (counts?.unassigned_interviews ?? 0)} onNavigate={() => setMenuOpen(false)} />
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
            <Route path="/interviews" element={<Interviews />} />
            <Route path="/interviews/:id" element={<EditorPage kind="interview" />} />
            <Route path="/notes/:id" element={<EditorPage kind="note" />} />
            <Route path="/add" element={<AddApplication />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="*" element={<p className="text-muted-foreground">Not found.</p>} />
          </Routes>
        </main>
        <EditorDialog />
      </div>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/applications", label: "Applications", icon: KanbanSquare },
  { to: "/interviews", label: "Interviews", icon: CalendarDays },
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
      <div className="mt-auto space-y-3 px-1">
        <ScanButton />
        <ThemeSwitch />
      </div>
    </div>
  );
}

function scanSummary(r: ScanResult): string {
  if (r.started_fresh) return "Now watching your inbox. New mail from here on will be picked up.";
  if (r.seen === 0) return "No new mail.";
  const parts = [`${r.seen} new email${r.seen === 1 ? "" : "s"}`, `${r.job} job-related`];
  if (r.created) parts.push(`${r.created} new application${r.created === 1 ? "" : "s"}`);
  if (r.unassigned) parts.push(`${r.unassigned} to the inbox`);
  return parts.join(" · ");
}

function calendarSummary(r: CalendarSyncResult): string | null {
  const parts = [];
  if (r.created) parts.push(`${r.created} new interview${r.created === 1 ? "" : "s"} from the calendar`);
  if (r.cancelled) parts.push(`${r.cancelled} cancelled`);
  if (r.unassigned) parts.push(`${r.unassigned} to match`);
  return parts.length ? parts.join(" · ") : null;
}

// Runs the incremental ingest now (reads Gmail, paid LLM calls for job-like mail), then the
// calendar sync if it's connected (read-only, free). Local only for now; in AWS the scheduled
// Lambda does this every 15 minutes.
function ScanButton() {
  const { bump } = useRefresh();
  const status = useAsync(api.scanStatus).data;
  const calendar = useAsync(api.calendarStatus).data;
  const [busy, setBusy] = useState(false);
  if (!status?.available) return null;

  async function scan() {
    setBusy(true);
    const id = toast.loading("Checking your inbox…");
    try {
      const r = await api.scan();
      if (r.errors) toast.warning(`${scanSummary(r)}. Stopped at an email that failed; the next scan retries it.`, { id });
      else toast.success(scanSummary(r), { id });
    } catch (e) {
      toast.error(errorText(e), { id });
    }
    if (calendar?.connected) {
      try {
        const c = calendarSummary(await api.syncCalendar());
        if (c) toast.success(c);
      } catch (e) {
        toast.error(`Calendar: ${errorText(e)}`);
      }
    }
    bump();
    setBusy(false);
  }
  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" className="w-full justify-start" disabled={busy} onClick={scan}>
        <RefreshCw className={cn(busy && "animate-spin")} /> {busy ? "Scanning…" : calendar?.connected ? "Scan inbox & calendar" : "Scan inbox now"}
      </Button>
      <p className="px-1 text-xs text-muted-foreground">Last scan: {timeAgo(status.last_scan_at)}</p>
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
