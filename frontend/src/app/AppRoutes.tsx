import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { RouteSkeleton } from "./RouteSkeleton";

const AddApplication = lazy(() => import("@/pages/add-application/AddApplicationPage"));
const ApplicationPage = lazy(() => import("@/pages/application/ApplicationPage"));
const Applications = lazy(() => import("@/pages/applications/ApplicationsPage"));
const CalendarPage = lazy(() => import("@/pages/calendar/CalendarPage"));
const Campaigns = lazy(() => import("@/pages/campaigns/CampaignsPage"));
const DashboardPage = lazy(() => import("@/pages/dashboard/DashboardPage"));
const Discover = lazy(() => import("@/pages/discover/DiscoverPage"));
const DiscoverCriteria = lazy(() => import("@/pages/discover-criteria/DiscoverCriteriaPage"));
const DiscoverInsights = lazy(() => import("@/pages/discover-insights/DiscoverInsightsPage"));
const DiscoverSources = lazy(() => import("@/pages/discover-sources/DiscoverSourcesPage"));
const Inbox = lazy(() => import("@/pages/inbox/InboxPage"));
const Interviews = lazy(() => import("@/pages/interviews/InterviewsPage"));
const EditorPage = lazy(() => import("@/features/notes/EditorPage").then((module) => ({ default: module.EditorPage })));

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
    <Suspense fallback={<RouteSkeleton />}>
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
        <Route path="*" element={<p className="text-muted-foreground">Not found.</p>} />
      </Routes>
    </Suspense>
  );
}
