import { AGENT_CONTRACT_VERSION, type Snapshot } from "@kubepilot/contract";

/**
 * Phase 0 placeholder. Proves the agent can build and share the ingestion
 * contract with the backend. Real collection (K8s API + Prometheus PromQL,
 * PodSpec stripping, buffered/idempotent push) lands in Phase 1.
 */
function main() {
  // Type-only sanity: the agent will emit Snapshot values that match the
  // contract the backend validates. (No runtime work yet.)
  const _example: Pick<Snapshot, "contractVersion" | "payloadKind"> = {
    contractVersion: AGENT_CONTRACT_VERSION,
    payloadKind: "inventory",
  };

  console.log(
    `KubePilot agent (stub) — ingestion contract v${AGENT_CONTRACT_VERSION}, sample payloadKind="${_example.payloadKind}"`,
  );
  console.log("Phase 0 placeholder: real collection & push land in Phase 1.");
}

main();
