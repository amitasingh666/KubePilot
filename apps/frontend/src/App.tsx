export function App() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "10vh auto",
        padding: "0 1rem",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ marginBottom: 4 }}>KubePilot</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Kubernetes cost optimization — dashboard placeholder (Phase 0).
      </p>
      <p>
        The real dashboard (cost overview, cluster detail, recommendations) is built in
        Phase 4 against the Public API.
      </p>
    </main>
  );
}
