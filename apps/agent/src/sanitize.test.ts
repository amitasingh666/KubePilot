import { describe, it, expect } from "vitest";
import { isAllowedLabel, stripLabels, sanitizeSnapshot } from "./sanitize.js";
import type { Snapshot } from "@kubepilot/contract";

describe("isAllowedLabel", () => {
  it("keeps exact-match safe keys", () => {
    expect(isAllowedLabel("app")).toBe(true);
    expect(isAllowedLabel("k8s-app")).toBe(true);
    expect(isAllowedLabel("node.kubernetes.io/instance-type")).toBe(true);
  });
  it("keeps standard prefixed keys", () => {
    expect(isAllowedLabel("app.kubernetes.io/name")).toBe(true);
    expect(isAllowedLabel("eks.amazonaws.com/nodegroup")).toBe(true);
    expect(isAllowedLabel("karpenter.sh/nodepool")).toBe(true);
  });
  it("drops unknown / potentially sensitive keys", () => {
    expect(isAllowedLabel("owner-email")).toBe(false);
    expect(isAllowedLabel("internal-cost-center")).toBe(false);
    expect(isAllowedLabel("secret-token")).toBe(false);
  });
});

describe("stripLabels", () => {
  it("keeps only allowlisted entries", () => {
    expect(
      stripLabels({ app: "checkout", "owner-email": "a@b.com", "app.kubernetes.io/name": "checkout" }),
    ).toEqual({ app: "checkout", "app.kubernetes.io/name": "checkout" });
  });
  it("returns empty when nothing is allowed", () => {
    expect(stripLabels({ "owner-email": "x", team: "y" })).toEqual({});
  });
});

describe("sanitizeSnapshot", () => {
  it("passes usage snapshots through unchanged (no inventory)", () => {
    const snap = { payloadKind: "usage", usage: { workloads: [], nodes: [] } } as unknown as Snapshot;
    expect(sanitizeSnapshot(snap)).toBe(snap);
  });

  it("strips non-allowlisted labels on nodes and workloads, without mutating the input", () => {
    const snap = {
      payloadKind: "inventory",
      inventory: {
        nodes: [{ name: "n1", labels: { "node.kubernetes.io/instance-type": "m5.large", "owner-email": "a@b.com" } }],
        workloads: [{ name: "checkout", namespace: "shop", labels: { app: "checkout", "secret-x": "y" } }],
      },
    } as unknown as Snapshot;

    const out = sanitizeSnapshot(snap);
    expect(out.inventory!.nodes[0]!.labels).toEqual({ "node.kubernetes.io/instance-type": "m5.large" });
    expect(out.inventory!.workloads[0]!.labels).toEqual({ app: "checkout" });
    // input untouched (we returned copies)
    expect(snap.inventory!.workloads[0]!.labels).toHaveProperty("secret-x");
  });
});
