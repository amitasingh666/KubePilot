import { Routes, Route } from "react-router-dom";
import { RequireAuth } from "./lib/auth";
import { AppLayout } from "./components/layout";
import { LoginPage } from "./routes/login";
import { OverviewPage } from "./routes/overview";
import { ClustersPage } from "./routes/clusters";
import { ConnectClusterPage } from "./routes/connect-cluster";
import { ClusterDetailPage } from "./routes/cluster-detail";
import { RecommendationsPage } from "./routes/recommendations";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Everything below requires a session (RequireAuth) and shares the app shell. */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="/clusters" element={<ClustersPage />} />
        <Route path="/clusters/new" element={<ConnectClusterPage />} />
        <Route path="/clusters/:id" element={<ClusterDetailPage />} />
        <Route path="/recommendations" element={<RecommendationsPage />} />
      </Route>
    </Routes>
  );
}
