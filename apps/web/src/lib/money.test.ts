import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { majorOf, scaledOf, sumMajor, sumScaled, toMajorNumber } from "./money";

describe("scaledOf", () => {
  it("parses the API's six-decimal strings exactly", () => {
    expect(scaledOf("13953.600000")).toBe(13_953_600_000n);
    expect(scaledOf("0.000001")).toBe(1n);
    expect(scaledOf("1250.50")).toBe(1_250_500_000n);
    expect(scaledOf("7")).toBe(7_000_000n);
  });

  it("parses negatives without losing the sign", () => {
    expect(scaledOf("-1250.500000")).toBe(-1_250_500_000n);
    expect(scaledOf("-0.000001")).toBe(-1n);
  });

  it("treats a missing figure as zero rather than NaN", () => {
    expect(scaledOf(null)).toBe(0n);
    expect(scaledOf(undefined)).toBe(0n);
    expect(scaledOf("")).toBe(0n);
  });

  it("truncates beyond the sixth decimal instead of rounding into it", () => {
    expect(scaledOf("1.0000009")).toBe(1_000_000n);
    expect(scaledOf("1.9999999")).toBe(1_999_999n);
  });

  it("keeps precision a float would have lost", () => {
    const a = scaledOf("0.100000");
    const b = scaledOf("0.200000");
    expect(a + b).toBe(scaledOf("0.300000"));
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe("sumScaled", () => {
  it("adds in bigint, so a long column does not drift", () => {
    const column = Array.from({ length: 1000 }, () => "0.100000");
    expect(sumScaled(column)).toBe(scaledOf("100.000000"));
  });

  it("skips missing rows without poisoning the total", () => {
    expect(sumScaled(["1.500000", null, undefined, "", "2.500000"])).toBe(scaledOf("4.000000"));
  });

  it("returns zero for an empty column", () => {
    expect(sumScaled([])).toBe(0n);
  });

  it("nets debits against credits", () => {
    expect(sumScaled(["100.000000", "-40.000000", "-60.000000"])).toBe(0n);
  });
});

describe("the display boundary", () => {
  it("converts once, after the addition", () => {
    expect(toMajorNumber(13_953_600_000n)).toBe(13953.6);
    expect(sumMajor(["0.100000", "0.200000"])).toBe(0.3);
    expect(majorOf("1250.500000")).toBe(1250.5);
    expect(majorOf(null)).toBe(0);
  });
});

describe("money helpers — fuzz", () => {
  const literalArb = fc
    .tuple(fc.boolean(), fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 0, max: 999_999 }))
    .map(([negative, whole, fraction]) => `${negative ? "-" : ""}${whole}.${String(fraction).padStart(6, "0")}`);

  it("fuzz: parsing then re-rendering the string is a round trip", () => {
    fc.assert(
      fc.property(literalArb, (literal) => {
        const scaled = scaledOf(literal);
        const negative = scaled < 0n;
        const abs = negative ? -scaled : scaled;
        const rendered = `${negative ? "-" : ""}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0")}`;
        expect(scaledOf(rendered)).toBe(scaled);
      }),
      { numRuns: 500 },
    );
  });

  it("fuzz: summing is order-independent and equals a fold", () => {
    fc.assert(
      fc.property(fc.array(literalArb, { maxLength: 40 }), (values) => {
        const forward = sumScaled(values);
        const backward = sumScaled([...values].reverse());
        expect(backward).toBe(forward);
        expect(values.reduce((acc, v) => acc + scaledOf(v), 0n)).toBe(forward);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: a column and its negation always cancel exactly", () => {
    fc.assert(
      fc.property(fc.array(literalArb, { maxLength: 40 }), (values) => {
        const negated = values.map((v) => (v.startsWith("-") ? v.slice(1) : `-${v}`));
        expect(sumScaled([...values, ...negated])).toBe(0n);
      }),
      { numRuns: 300 },
    );
  });
});
