import { describe, it, expect } from "vitest";
import { buildPatch } from "./patches.js";
import type { AnyRecommendation } from "./persistRecommendations.js";

const cpu = { type: "cpu-rightsize", namespace: "shop", name: "checkout", proposedCpuM: 138 } as AnyRecommendation;
const mem = { type: "memory-rightsize", namespace: "shop", name: "checkout", proposedMemBytes: 230 * 1048576 } as AnyRecommendation;
const replica = { type: "replica-optimize", namespace: "shop", name: "checkout", proposedReplicas: 2 } as AnyRecommendation;
const node = { type: "node-consolidate", clusterName: "prod" } as AnyRecommendation;
const pvc = { type: "pvc-cleanup", namespace: "shop", name: "data-1" } as AnyRecommendation;

describe("buildPatch", () => {
  it("emits an imperative kubectl command for a non-GitOps CPU rec", () => {
    const p = buildPatch(cpu, false)!;
    expect(p.patchMode).toBe("kubectl");
    expect(p.patch).toContain("set resources deployment/checkout --requests=cpu=138m");
  });

  it("emits a GitOps note (not a raw kubectl) for a GitOps-owned workload", () => {
    const p = buildPatch(cpu, true)!;
    expect(p.patchMode).toBe("gitops");
    expect(p.patch).toContain("source manifest");
  });

  it("sets memory request == limit (Guaranteed QoS)", () => {
    const p = buildPatch(mem, false)!;
    expect(p.patch).toContain("--requests=memory=230Mi");
    expect(p.patch).toContain("--limits=memory=230Mi");
  });

  it("scales replicas", () => {
    expect(buildPatch(replica, false)!.patch).toContain("scale deployment/checkout --replicas=2");
  });

  it("warns loudly on PVC deletion", () => {
    expect(buildPatch(pvc, false)!.patch).toContain("DESTROYS DATA");
  });

  it("returns null for node consolidation (no single command)", () => {
    expect(buildPatch(node, false)).toBeNull();
  });
});
