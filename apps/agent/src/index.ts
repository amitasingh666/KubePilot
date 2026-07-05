import { KubeConfig } from "@kubernetes/client-node";
import { collectInventorySnapshot } from "./collect.js";
import { collectUsageSnapshot } from "./usage.js";

const AGENT_VERSION = "0.0.1";
// The real cluster id is injected at Helm install (Stage I). For local dev it
// comes from an env var, with a placeholder fallback so validation passes.
const CLUSTER_ID = process.env.AGENT_CLUSTER_ID ?? "00000000-0000-0000-0000-000000000000";

async function main() {
  const kc = new KubeConfig();
  kc.loadFromDefault(); // local kubeconfig now; in-cluster config later (Stage I)


  const inventorySnapshot = await collectInventorySnapshot(kc, CLUSTER_ID, AGENT_VERSION);
  const inv = inventorySnapshot.inventory!;
  console.log(
    `✅ inventory snapshot: ${inv.nodes.length} nodes, ` +
      `${inv.workloads.length} workloads, ${inv.autoscalers.length} autoscalers, ` +
      `${inv.pvcs.length} pvcs, ${inv.services.length} services`,
  );


  const usageSnapshot = await collectUsageSnapshot(kc, CLUSTER_ID, AGENT_VERSION);
  const usage = usageSnapshot.usage!;
  console.log(JSON.stringify(usageSnapshot, null, 2));
  console.log(
    `✅ usage snapshot: ${usage.workloads.length} workloads over window ` +
      `[${usage.workloads[0]?.windowStart ?? "n/a"} → ${usage.workloads[0]?.windowEnd ?? "n/a"}]`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
