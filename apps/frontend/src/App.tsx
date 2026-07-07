import { Routes, Route } from "react-router-dom";
import { RequireAuth } from "./lib/auth";
import { AppLayout } from "./components/layout";
import { LoginPage } from "./routes/login";
import { OverviewPage } from "./routes/overview";

// Placeholder for pages built in later stages, so the nav never 404s.
function Placeholder({ title, stage }: { title: string; stage: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">Built in {stage}.</p>
    </div>
  );
}

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
        <Route path="/clusters" element={<Placeholder title="Clusters" stage="Stage E / G" />} />
        <Route path="/recommendations" element={<Placeholder title="Recommendations" stage="Stage H" />} />
      </Route>
    </Routes>
  );
}
