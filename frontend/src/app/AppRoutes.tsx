import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import AddApplication from "@/pages/add-application/AddApplicationPage";
import ApplicationPage from "@/pages/application/ApplicationPage";
import ApplyExperiencePage from "@/pages/apply-experience/ApplyExperiencePage";
import ApplyFactsPage from "@/pages/apply-facts/ApplyFactsPage";
import ApplyQuestionsPage from "@/pages/apply-questions/ApplyQuestionsPage";
import Applications from "@/pages/applications/ApplicationsPage";
import CalendarPage from "@/pages/calendar/CalendarPage";
import Campaigns from "@/pages/campaigns/CampaignsPage";
import DashboardPage from "@/pages/dashboard/DashboardPage";
import Discover from "@/pages/discover/DiscoverPage";
import DiscoverCriteria from "@/pages/discover-criteria/DiscoverCriteriaPage";
import DiscoverInsights from "@/pages/discover-insights/DiscoverInsightsPage";
import DiscoverSources from "@/pages/discover-sources/DiscoverSourcesPage";
import Inbox from "@/pages/inbox/InboxPage";
import Interviews from "@/pages/interviews/InterviewsPage";
import { EditorPage } from "@/features/notes/EditorPage";

// The old settings page's tabs, now on two pages.
const SETTINGS_TABS = new Map([
  ["criteria", "/discover/criteria"],
  ["rules", "/discover/criteria?tab=rules"],
  ["sources", "/discover/sources"],
  ["runs", "/discover/sources?tab=runs"],
]);

function DiscoverSettingsRedirect() {
  const [params] = useSearchParams();
  return <Navigate replace to={SETTINGS_TABS.get(params.get("tab") ?? "") ?? "/discover/criteria"} />;
}

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
      <Route path="/discover/sources" element={<DiscoverSources />} />
      <Route path="/discover/criteria" element={<DiscoverCriteria />} />
      <Route path="/discover/insights" element={<DiscoverInsights />} />
      <Route path="/discover/settings" element={<DiscoverSettingsRedirect />} />
      <Route path="/apply" element={<ApplyQuestionsPage />} />
      <Route path="/apply/experience" element={<ApplyExperiencePage />} />
      <Route path="/apply/facts" element={<ApplyFactsPage />} />
      <Route path="*" element={<p className="text-muted-foreground">Not found.</p>} />
    </Routes>
  );
}
