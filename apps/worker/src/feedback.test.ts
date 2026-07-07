import { describe, it, expect } from "vitest";
import { detectOutcomes, type Revision, type StabilityEvent } from "./feedback.js";

const day = (d: number) => new Date(2026, 0, d);

const rev = (observedAt: Date, over: Partial<Revision> = {}): Revision => ({
  observedAt,
  cpuRequestM: 1000,
  memRequestBytes: 2_000_000_000,
  replicas: 3,
  ...over,
});

describe("detectOutcomes", () => {
  it("detects a CPU request drop as an applied optimization", () => {
    const out = detectOutcomes([rev(day(1)), rev(day(2), { cpuRequestM: 300 })], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ resource: "cpu", fromValue: 1000, toValue: 300, safe: true });
  });

  it("ignores drops smaller than the threshold", () => {
    // 1000 → 950 is only 5% — below the 10% floor.
    expect(detectOutcomes([rev(day(1)), rev(day(2), { cpuRequestM: 950 })], [])).toHaveLength(0);
  });

  it("ignores increases (that's not an optimization)", () => {
    expect(detectOutcomes([rev(day(1)), rev(day(2), { cpuRequestM: 1500 })], [])).toHaveLength(0);
  });

  it("flags a memory cut followed by an OOMKill as UNSAFE", () => {
    const revs = [rev(day(1)), rev(day(2), { memRequestBytes: 500_000_000 })];
    const events: StabilityEvent[] = [{ ts: day(3), kind: "oomkill" }];
    const out = detectOutcomes(revs, events);
    const mem = out.find((o) => o.resource === "memory")!;
    expect(mem.safe).toBe(false);
  });

  it("keeps a memory cut SAFE when the OOMKill predates it", () => {
    const revs = [rev(day(5)), rev(day(6), { memRequestBytes: 500_000_000 })];
    const events: StabilityEvent[] = [{ ts: day(1), kind: "oomkill" }]; // before the cut
    const mem = detectOutcomes(revs, events).find((o) => o.resource === "memory")!;
    expect(mem.safe).toBe(true);
  });

  it("treats a CPU cut as safe even with an OOMKill (CPU isn't OOM-risky)", () => {
    const revs = [rev(day(1)), rev(day(2), { cpuRequestM: 200 })];
    const cpu = detectOutcomes(revs, [{ ts: day(3), kind: "oomkill" }]).find((o) => o.resource === "cpu")!;
    expect(cpu.safe).toBe(true);
  });
});
