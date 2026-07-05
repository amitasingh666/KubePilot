import { KubeConfig } from "@kubernetes/client-node";
import { startPushLoop } from "./pushLoop.js";

const AGENT_VERSION = "0.0.1";
// The real cluster id is injected at Helm install (Stage I). For local dev it
// comes from an env var, with a placeholder fallback so validation passes.
const CLUSTER_ID = process.env.AGENT_CLUSTER_ID ?? "00000000-0000-0000-0000-000000000000";
// The kp_... token from the cluster connection. Injected by Helm (Stage I).
const AGENT_TOKEN = process.env.AGENT_TOKEN;

async function main() {
  // Fail fast with a clear message if we can't authenticate to /ingest.
  if (!AGENT_TOKEN) {
    console.error("AGENT_TOKEN is required (the kp_... token from the cluster connection)");
    process.exit(1);
  }

  const kc = new KubeConfig();
  kc.loadFromDefault(); // local kubeconfig now; in-cluster config later (Stage I)

  // Start the scheduled push loop. It runs forever via setInterval, so main()
  // returns while the agent keeps collecting + pushing in the background.
  startPushLoop(kc, CLUSTER_ID, AGENT_VERSION, AGENT_TOKEN);
  console.log(
    `✅ agent started (cluster=${CLUSTER_ID}, version=${AGENT_VERSION}) — ` +
      `collecting + pushing to the ingestion API`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
