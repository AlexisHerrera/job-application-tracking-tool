import { Route, Routes } from "react-router-dom";
import AddApplication from "@/pages/AddApplication";
import ApplicationPage from "@/pages/application/ApplicationPage";
import Applications from "@/pages/applications/ApplicationsPage";
import CalendarPage from "@/pages/calendar/CalendarPage";
import Campaigns from "@/pages/Campaigns";
import DashboardPage from "@/pages/dashboard/DashboardPage";
import Discover from "@/pages/discover/DiscoverPage";
import Inbox from "@/pages/Inbox";
import Interviews from "@/pages/Interviews";
import { EditorPage } from "@/features/notes/EditorPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/applications" element={<Applications />} />
      <Route path="/applications/:id" element={<ApplicationPage />} />
      <Route path="/inbox" element={<Inbox />} />
      <Route path="/interviews" element={<Interviews />} />
      <Route path="/calendar" element={<CalendarPage />} />
      <Route path="/interviews/:id" element={<EditorPage kind="interview" />} />
      <Route path="/notes/:id" element={<EditorPage kind="note" />} />
      <Route path="/add" element={<AddApplication />} />
      <Route path="/campaigns" element={<Campaigns />} />
      <Route path="/discover" element={<Discover />} />
      <Route path="*" element={<p className="text-muted-foreground">Not found.</p>} />
    </Routes>
  );
}
