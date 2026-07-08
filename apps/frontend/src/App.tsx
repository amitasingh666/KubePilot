import { Routes, Route } from "react-router-dom";
import { RequireAuth } from "./lib/auth";
import { AppLayout } from "./components/layout";
import { PublicLayout } from "./components/public-layout";
import { LandingPage } from "./routes/landing";
import { DocsPage } from "./routes/docs";
import { FaqPage } from "./routes/faq";
import { LoginPage } from "./routes/login";
import { RegisterPage } from "./routes/register";
import { OverviewPage } from "./routes/overview";
import { ClustersPage } from "./routes/clusters";
import { ConnectClusterPage } from "./routes/connect-cluster";
import { ClusterDetailPage } from "./routes/cluster-detail";
import { RecommendationsPage } from "./routes/recommendations";
import { ReportsPage } from "./routes/reports";
import { TeamPage } from "./routes/team";
import { AcceptInvitePage } from "./routes/accept-invite";

export function App() {
  return (
    <Routes>
      {/* ── Public marketing (shared nav + footer) ── */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/faq" element={<FaqPage />} />
      </Route>

      {/* ── Public auth screens (no marketing shell) ── */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      {/* ── App (requires a session), all under /app ── */}
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="clusters" element={<ClustersPage />} />
        <Route path="clusters/new" element={<ConnectClusterPage />} />
        <Route path="clusters/:id" element={<ClusterDetailPage />} />
        <Route path="recommendations" element={<RecommendationsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="team" element={<TeamPage />} />
      </Route>
    </Routes>
  );
}
