import { KubeConfig } from "@kubernetes/client-node";
import { collectInventorySnapshot } from "./collect.js";

const AGENT_VERSION = "0.0.1";
// The real cluster id is injected at Helm install (Stage I). For local dev it
// comes from an env var, with a placeholder fallback so validation passes.
const CLUSTER_ID = process.env.AGENT_CLUSTER_ID ?? "00000000-0000-0000-0000-000000000000";

async function main() {
  const kc = new KubeConfig();
  kc.loadFromDefault(); // local kubeconfig now; in-cluster config later (Stage I)

  const snapshot = await collectInventorySnapshot(kc, CLUSTER_ID, AGENT_VERSION);

  const inv = snapshot.inventory!;
  console.log(JSON.stringify(snapshot, null, 2));
  console.log(
    `✅ valid inventory snapshot: ${inv.nodes.length} nodes, ` +
      `${inv.workloads.length} workloads, ${inv.autoscalers.length} autoscalers, ` +
      `${inv.pvcs.length} pvcs, ${inv.services.length} services`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
