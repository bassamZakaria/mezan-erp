import { describe, it, expect } from "vitest";
import { Money } from "./money.js";

describe("Money", () => {
  it("parses and renders exact decimal strings at scale 1e-6", () => {
    expect(Money.fromMajor("1250.50").toString()).toBe("1250.500000");
    expect(Money.fromMajor("0.000001").scaled).toBe(1n);
    expect(Money.fromMajor("-3.25").toString()).toBe("-3.250000");
    expect(Money.fromMajor("100").toString()).toBe("100.000000");
  });

  it("rejects malformed literals and excess precision", () => {
    expect(() => Money.fromMajor("1.2.3")).toThrow();
    expect(() => Money.fromMajor("abc")).toThrow();
    expect(() => Money.fromMajor("0.0000001")).toThrow(); // 7 dp
  });

  it("add / negate / equals", () => {
    const a = Money.fromMajor("10.50");
    const b = Money.fromMajor("4.25");
    expect(a.add(b).toString()).toBe("14.750000");
    expect(a.add(b.negate()).toString()).toBe("6.250000");
    expect(a.equals(Money.fromMajor("10.50"))).toBe(true);
    expect(a.equals(b)).toBe(false);
  });

  it("sum over a list is exact", () => {
    const lines = ["100.10", "200.20", "300.30"].map(Money.fromMajor);
    expect(Money.sum(lines).toString()).toBe("600.600000");
  });

  // Proof test #4: scaled ints do NOT drift where IEEE-754 floats do.
  it("does not drift like IEEE-754 floats under repeated addition", () => {
    // Baseline: naive float accumulation drifts.
    let asFloat = 0;
    for (let i = 0; i < 10; i++) asFloat += 0.1;
    expect(asFloat).not.toBe(1); // 0.9999999999999999

    // Scaled-int Money: exact.
    const dime = Money.fromMajor("0.1");
    let asMoney = Money.zero();
    for (let i = 0; i < 10; i++) asMoney = asMoney.add(dime);
    expect(asMoney.equals(Money.fromMajor("1"))).toBe(true);
    expect(asMoney.toString()).toBe("1.000000");

    // A larger run that would visibly accumulate float error.
    const cent = Money.fromMajor("0.01");
    let total = Money.zero();
    for (let i = 0; i < 1_000_000; i++) total = total.add(cent);
    expect(total.toString()).toBe("10000.000000");
  });

  it("round-trips through the SQLite scaled-integer boundary", () => {
    const m = Money.fromMajor("987.654321");
    const persisted = m.toScaledNumber(); // what goes into INTEGER
    expect(persisted).toBe(987654321);
    expect(Money.fromScaled(persisted).equals(m)).toBe(true);
  });
});
