import { describe, it, expect } from "vitest";
import { Qty } from "./qty.js";

describe("Qty", () => {
  it("parses and renders exact decimal strings at scale 1e-6", () => {
    expect(Qty.fromMajor("12.5").toString()).toBe("12.500000");
    expect(Qty.fromMajor("0.000001").scaled).toBe(1n);
    expect(Qty.fromMajor("-3.25").toString()).toBe("-3.250000");
    expect(Qty.fromMajor("100").toString()).toBe("100.000000");
  });

  it("rejects malformed literals and excess precision", () => {
    expect(() => Qty.fromMajor("1.2.3")).toThrow();
    expect(() => Qty.fromMajor("abc")).toThrow();
    expect(() => Qty.fromMajor("0.0000001")).toThrow(); // 7 dp
  });

  it("add / subtract / negate / equals", () => {
    const a = Qty.fromMajor("10.5");
    const b = Qty.fromMajor("4.25");
    expect(a.add(b).toString()).toBe("14.750000");
    expect(a.subtract(b).toString()).toBe("6.250000");
    expect(a.negate().toString()).toBe("-10.500000");
    expect(a.equals(Qty.fromMajor("10.5"))).toBe(true);
    expect(a.equals(b)).toBe(false);
  });

  it("timesInteger scales by an exact whole multiple", () => {
    expect(Qty.fromMajor("2.5").timesInteger(4).toString()).toBe("10.000000");
    expect(() => Qty.fromMajor("1").timesInteger(1.5)).toThrow();
  });

  it("compare / isZero / isNegative", () => {
    expect(Qty.fromMajor("1").compare(Qty.fromMajor("2"))).toBe(-1);
    expect(Qty.fromMajor("2").compare(Qty.fromMajor("2"))).toBe(0);
    expect(Qty.fromMajor("3").compare(Qty.fromMajor("2"))).toBe(1);
    expect(Qty.zero().isZero()).toBe(true);
    expect(Qty.fromMajor("-1").isNegative()).toBe(true);
  });

  it("sum over a list is exact", () => {
    const rows = ["1.1", "2.2", "3.3"].map(Qty.fromMajor);
    expect(Qty.sum(rows).toString()).toBe("6.600000");
  });

  it("does not drift like IEEE-754 floats under repeated addition", () => {
    const tenth = Qty.fromMajor("0.1");
    let acc = Qty.zero();
    for (let i = 0; i < 1_000_000; i++) acc = acc.add(tenth);
    expect(acc.toString()).toBe("100000.000000");
  });

  it("round-trips through the SQLite scaled-integer boundary", () => {
    const q = Qty.fromMajor("987.654321");
    const persisted = q.toScaledNumber();
    expect(persisted).toBe(987654321);
    expect(Qty.fromScaled(persisted).equals(q)).toBe(true);
  });
});
