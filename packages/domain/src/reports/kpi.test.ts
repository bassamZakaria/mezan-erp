import { describe, it, expect } from "vitest";
import { averageOf, countDistinct, countRows, diffOf, maxOf, percentOf, sumRows } from "./kpi.js";

describe("sumRows", () => {
  it("adds a numeric field across rows exactly, without float drift", () => {
    const rows = Array.from({ length: 300 }, () => ({ amount: 227.14 }));
    expect(sumRows(rows, (r) => r.amount)).toBe(68142);
    // The naive float sum of the same values drifts off the exact answer.
    expect(rows.reduce((s, r) => s + r.amount, 0)).not.toBe(68142);
  });

  it("skips null/undefined/non-finite values rather than poisoning the total", () => {
    const rows: { amount: number | null | undefined }[] = [
      { amount: 10 },
      { amount: null },
      { amount: undefined },
      { amount: Number.NaN },
      { amount: 5 },
    ];
    expect(sumRows(rows, (r) => r.amount)).toBe(15);
  });

  it("sums to 0 over an empty row set", () => {
    expect(sumRows([], () => 1)).toBe(0);
  });
});

describe("diffOf", () => {
  it("subtracts two piastre-exact amounts without float error", () => {
    expect(diffOf(6455.4, 18527.6)).toBe(-12072.2);
  });

  it("returns 0 for equal inputs", () => {
    expect(diffOf(100, 100)).toBe(0);
  });
});

describe("countRows", () => {
  it("counts rows matching a predicate", () => {
    const rows = [{ overdue: true }, { overdue: false }, { overdue: true }];
    expect(countRows(rows, (r) => r.overdue)).toBe(2);
  });

  it("is 0 over an empty row set", () => {
    expect(countRows([], () => true)).toBe(0);
  });
});

describe("countDistinct", () => {
  it("counts distinct non-empty string values", () => {
    const rows = [{ customerId: "c1" }, { customerId: "c2" }, { customerId: "c1" }];
    expect(countDistinct(rows, (r) => r.customerId)).toBe(2);
  });

  it("ignores null, undefined and empty-string values", () => {
    const rows: { customerId: string | null | undefined }[] = [
      { customerId: "c1" },
      { customerId: null },
      { customerId: undefined },
      { customerId: "" },
    ];
    expect(countDistinct(rows, (r) => r.customerId)).toBe(1);
  });
});

describe("maxOf", () => {
  it("returns the largest numeric value", () => {
    expect(maxOf([{ v: 3 }, { v: 9 }, { v: 5 }], (r) => r.v)).toBe(9);
  });

  it("returns 0 over no rows", () => {
    expect(maxOf([], () => 1)).toBe(0);
  });

  it("returns 0 when every value is non-numeric", () => {
    expect(maxOf([{ v: null }, { v: undefined }], (r) => r.v)).toBe(0);
  });

  it("does not let a negative value hide behind the 0-default", () => {
    expect(maxOf([{ v: -5 }, { v: -1 }], (r) => r.v)).toBe(-1);
  });
});

describe("percentOf", () => {
  it("computes a percentage quantised to two decimals", () => {
    expect(percentOf(1, 3)).toBe(33.33);
  });

  it("is 0 — not Infinity or NaN — when the denominator is 0", () => {
    expect(percentOf(50, 0)).toBe(0);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("averageOf", () => {
  it("divides total by count at money precision", () => {
    expect(averageOf(100, 4)).toBe(25);
  });

  it("divides exactly over a fractional count", () => {
    expect(averageOf(100, 12.5)).toBe(8);
  });

  it("is 0 — not Infinity or NaN — over a 0 count", () => {
    expect(averageOf(100, 0)).toBe(0);
  });
});
