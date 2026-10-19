import { NavLink, Route, Routes } from "react-router-dom";
import AddApplication from "./pages/AddApplication";
import ApplicationDetail from "./pages/ApplicationDetail";
import Applications from "./pages/Applications";
import DashboardPage from "./pages/Dashboard";
import Inbox from "./pages/Inbox";

export default function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Job Tracker</span>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/applications">Applications</NavLink>
          <NavLink to="/inbox">Inbox</NavLink>
          <NavLink to="/add">Add</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/applications/:id" element={<ApplicationDetail />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/add" element={<AddApplication />} />
          <Route path="*" element={<p>Not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
