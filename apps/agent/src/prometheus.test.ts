import { describe, it, expect } from "vitest";
import { durationToSeconds } from "./prometheus.js";

describe("durationToSeconds", () => {
  it("parses valid Prometheus durations", () => {
    expect(durationToSeconds("45s")).toBe(45);
    expect(durationToSeconds("30m")).toBe(1800);
    expect(durationToSeconds("6h")).toBe(21600);
    expect(durationToSeconds("7d")).toBe(604800);
    expect(durationToSeconds("2w")).toBe(1209600);
  });

  it("throws on malformed input", () => {
    expect(() => durationToSeconds("banana")).toThrow(/invalid duration/);
    expect(() => durationToSeconds("10x")).toThrow();
    expect(() => durationToSeconds("")).toThrow();
  });
});
