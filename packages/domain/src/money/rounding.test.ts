import { describe, it, expect } from "vitest";
import { Money } from "./money.js";
import {
  allocate,
  allocateScaled,
  roundMoney,
  ROUNDING_BOUNDARIES,
} from "./rounding.js";

/** Small deterministic PRNG so "property" runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("roundMoney", () => {
  it("rounds to N decimals with HALF_UP by default", () => {
    expect(roundMoney(Money.fromMajor("1.005"), 2).toString()).toBe("1.010000");
    expect(roundMoney(Money.fromMajor("1.004"), 2).toString()).toBe("1.000000");
    expect(roundMoney(Money.fromMajor("-1.005"), 2).toString()).toBe(
      "-1.010000",
    );
  });

  it("supports HALF_EVEN (banker's), DOWN, UP, FLOOR, CEIL", () => {
    expect(roundMoney(Money.fromMajor("2.5"), 0, "HALF_EVEN").toString()).toBe(
      "2.000000",
    );
    expect(roundMoney(Money.fromMajor("3.5"), 0, "HALF_EVEN").toString()).toBe(
      "4.000000",
    );
    expect(roundMoney(Money.fromMajor("1.999"), 2, "DOWN").toString()).toBe(
      "1.990000",
    );
    expect(roundMoney(Money.fromMajor("1.991"), 2, "UP").toString()).toBe(
      "2.000000",
    );
    expect(roundMoney(Money.fromMajor("-1.001"), 2, "FLOOR").toString()).toBe(
      "-1.010000",
    );
    expect(roundMoney(Money.fromMajor("1.001"), 2, "CEIL").toString()).toBe(
      "1.010000",
    );
  });

  it("is a no-op when already at or above the target precision", () => {
    expect(roundMoney(Money.fromMajor("1.5"), 6).toString()).toBe("1.500000");
  });

  it("names its four rounding boundaries", () => {
    expect(ROUNDING_BOUNDARIES).toEqual([
      "LINE_EXTENSION",
      "TAX_COMPUTATION",
      "DISCOUNT_ALLOCATION",
      "LANDED_COST_DISTRIBUTION",
    ]);
  });
});

describe("allocate (largest-remainder)", () => {
  it("splits a total that does not divide evenly, reconciling exactly", () => {
    // The classic case: 100.00 across 3 equal parts.
    const parts = allocate(Money.fromMajor("100"), [1, 1, 1]);
    expect(parts.map((p) => p.toString())).toEqual([
      "33.333334",
      "33.333333",
      "33.333333",
    ]);
    expect(Money.sum(parts).toString()).toBe("100.000000");
  });

  it("weights the split and hands residue to the largest remainder", () => {
    const parts = allocate(Money.fromMajor("10"), [1, 2, 3]);
    expect(Money.sum(parts).toString()).toBe("10.000000");
  });

  it("handles negative totals (reversing entries) and reconciles", () => {
    const parts = allocate(Money.fromMajor("-100"), [1, 1, 1]);
    expect(Money.sum(parts).toString()).toBe("-100.000000");
  });

  it("rejects empty weights, negative weights, and zero total weight", () => {
    expect(() => allocate(Money.fromMajor("1"), [])).toThrow();
    expect(() => allocate(Money.fromMajor("1"), [-1, 2])).toThrow();
    expect(() => allocate(Money.fromMajor("1"), [0, 0])).toThrow();
  });

  it("is deterministic: equal remainders break ties by lowest index", () => {
    // 1 micro-unit over two equal weights -> the leftover unit goes to index 0.
    const parts = allocateScaled(3n, [1, 1]);
    expect(parts).toEqual([2n, 1n]);
  });

  // Property-style: over many random totals/weights, parts ALWAYS sum to total
  // exactly, and no part is off from its ideal share by a whole unit or more.
  it("always reconciles exactly with no float drift (randomized)", () => {
    const rand = mulberry32(1234567);
    for (let iter = 0; iter < 2000; iter++) {
      const n = 1 + Math.floor(rand() * 8);
      const weights = Array.from({ length: n }, () =>
        Math.floor(rand() * 1000),
      );
      if (weights.reduce((a, b) => a + b, 0) === 0) weights[0] = 1;
      const totalScaled =
        BigInt(Math.floor(rand() * 100_000_000)) *
        (rand() < 0.5 ? -1n : 1n);

      const parts = allocateScaled(totalScaled, weights);

      // 1. Parts reconcile to the total EXACTLY.
      const sum = parts.reduce((a, b) => a + b, 0n);
      expect(sum).toBe(totalScaled);

      // 2. Each part is within one unit of its ideal (fair) share.
      const W = BigInt(weights.reduce((a, b) => a + b, 0));
      for (let i = 0; i < n; i++) {
        const ideal = (totalScaled * BigInt(weights[i] as number)) / W;
        const diff = (parts[i] as bigint) - ideal;
        expect(diff >= -1n && diff <= 1n).toBe(true);
      }
    }
  });
});
