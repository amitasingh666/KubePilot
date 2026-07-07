import { describe, it, expect } from "vitest";
import {
  rightsizeMonthlyUsd,
  replicaMonthlyUsd,
  storageMonthlyUsd,
  savingsKindFor,
} from "./recPricing.js";
import { HOURS_PER_MONTH } from "./currentCost.js";

const perMCpu = (0.192 * 0.5) / 4000; // two m5.large nodes, CPU half

describe("rightsizeMonthlyUsd", () => {
  it("prices a per-pod reduction for a single replica", () => {
    expect(rightsizeMonthlyUsd(900, 300, 1, perMCpu)).toBeCloseTo(600 * perMCpu * HOURS_PER_MONTH, 6);
  });

  it("A1 regression: multiplies by replicas", () => {
    // 10 replicas × 600m freed — the old code dropped the ×10.
    const one = rightsizeMonthlyUsd(900, 300, 1, perMCpu);
    const ten = rightsizeMonthlyUsd(900, 300, 10, perMCpu);
    expect(ten).toBeCloseTo(one * 10, 6);
  });

  it("never goes negative for under-provisioned workloads", () => {
    expect(rightsizeMonthlyUsd(300, 900, 5, perMCpu)).toBe(0);
  });
});

describe("replicaMonthlyUsd", () => {
  it("prices removed pods at their full per-pod request", () => {
    const perByte = (0.192 * 0.5) / 16_000_000_000;
    const usd = replicaMonthlyUsd(5, 2, 500, 1_000_000_000, perMCpu, perByte);
    const perPod = 500 * perMCpu + 1_000_000_000 * perByte;
    expect(usd).toBeCloseTo(3 * perPod * HOURS_PER_MONTH, 6);
  });

  it("is zero when replicas don't drop", () => {
    expect(replicaMonthlyUsd(3, 3, 500, 1e9, perMCpu, 0)).toBe(0);
  });
});

describe("storageMonthlyUsd", () => {
  it("prices bytes at $/GB-month", () => {
    expect(storageMonthlyUsd(100_000_000_000, 0.08)).toBeCloseTo(100 * 0.08, 4); // 100GB × $0.08
  });
});

describe("savingsKindFor", () => {
  it("tags node/volume reclaim as realized, request cuts as waste", () => {
    expect(savingsKindFor("node-consolidate")).toBe("realized");
    expect(savingsKindFor("pvc-cleanup")).toBe("realized");
    expect(savingsKindFor("cpu-rightsize")).toBe("waste");
    expect(savingsKindFor("memory-rightsize")).toBe("waste");
    expect(savingsKindFor("replica-optimize")).toBe("waste");
    expect(savingsKindFor("cleanup")).toBeNull();
  });
});
