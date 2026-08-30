import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Money } from "./money.js";
import { Qty } from "./qty.js";
import { allocate, allocateScaled, roundMoney, type RoundingMode } from "./rounding.js";

const SCALE = 1_000_000n;

const scaledArb = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const positiveScaledArb = fc.bigInt({ min: 1n, max: 10n ** 15n });
const weightsArb = fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { minLength: 1, maxLength: 24 })
  .filter((w) => w.reduce((a, b) => a + b, 0n) > 0n);

function majorLiteral(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  return `${negative ? "-" : ""}${abs / SCALE}.${(abs % SCALE).toString().padStart(6, "0")}`;
}

describe("Money — fuzz", () => {
  it("fuzz: fromMajor and toString round-trip any scaled value exactly", () => {
    fc.assert(
      fc.property(scaledArb, (scaled) => {
        const money = Money.fromMajor(majorLiteral(scaled));
        expect(money.scaled).toBe(scaled);
        expect(money.toString()).toBe(majorLiteral(scaled));
      }),
      { numRuns: 500 },
    );
  });

  it("fuzz: addition is commutative, associative and has zero as identity", () => {
    fc.assert(
      fc.property(scaledArb, scaledArb, scaledArb, (a, b, c) => {
        const x = Money.fromScaled(a);
        const y = Money.fromScaled(b);
        const z = Money.fromScaled(c);
        expect(x.add(y).scaled).toBe(y.add(x).scaled);
        expect(x.add(y).add(z).scaled).toBe(x.add(y.add(z)).scaled);
        expect(x.add(Money.zero()).scaled).toBe(x.scaled);
        expect(x.add(x.negate()).scaled).toBe(0n);
      }),
      { numRuns: 500 },
    );
  });

  it("fuzz: sum equals a left fold of add, for any list length", () => {
    fc.assert(
      fc.property(fc.array(scaledArb, { maxLength: 60 }), (values) => {
        const items = values.map((v) => Money.fromScaled(v));
        const folded = items.reduce((acc, m) => acc.add(m), Money.zero());
        expect(Money.sum(items).scaled).toBe(folded.scaled);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: no float can reproduce the exact string, which is the point of the bigint", () => {
    fc.assert(
      fc.property(scaledArb, (scaled) => {
        const money = Money.fromScaled(scaled);
        expect(money.toJSON()).toBe(money.toString());
        expect(typeof money.toJSON()).toBe("string");
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: rejects any literal with more than six decimals or stray characters", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant("1.0000001"),
          fc.constant("1,50"),
          fc.constant("١٢٣"),
          fc.constant(""),
          fc.constant("."),
          fc.constant("1e3"),
          fc.constant("Infinity"),
          fc.constant("NaN"),
          fc.constant("0x10"),
          fc.constant("--1"),
          fc.constant("1.2.3"),
          fc.constant(" 1 . 5 "),
        ),
        (literal) => {
          expect(() => Money.fromMajor(literal)).toThrow(RangeError);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("fuzz: fromScaled refuses any number outside the safe-integer range", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }).filter((n) => !Number.isSafeInteger(n)), (n) => {
        expect(() => Money.fromScaled(n)).toThrow(RangeError);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Qty — fuzz", () => {
  it("fuzz: quantity round-trips and subtracts back to zero", () => {
    fc.assert(
      fc.property(scaledArb, scaledArb, (a, b) => {
        const x = Qty.fromScaled(a);
        const y = Qty.fromScaled(b);
        expect(Qty.fromMajor(x.toString()).scaled).toBe(a);
        expect(x.add(y).subtract(y).scaled).toBe(a);
        expect(x.compare(y)).toBe(a < b ? -1 : a > b ? 1 : 0);
        expect(x.isZero()).toBe(a === 0n);
        expect(x.isNegative()).toBe(a < 0n);
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: timesInteger is exact repeated addition", () => {
    fc.assert(
      fc.property(scaledArb, fc.integer({ min: 0, max: 40 }), (a, factor) => {
        const q = Qty.fromScaled(a);
        let acc = Qty.zero();
        for (let i = 0; i < factor; i++) acc = acc.add(q);
        expect(q.timesInteger(factor).scaled).toBe(acc.scaled);
      }),
      { numRuns: 200 },
    );
  });
});

describe("allocation — fuzz", () => {
  it("fuzz: parts sum EXACTLY to the total, for any weights and any sign", () => {
    fc.assert(
      fc.property(scaledArb, weightsArb, (total, weights) => {
        const parts = allocateScaled(total, weights);
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
        expect(parts).toHaveLength(weights.length);
      }),
      { numRuns: 600 },
    );
  });

  it("fuzz: every part is within one unit of its ideal share", () => {
    fc.assert(
      fc.property(positiveScaledArb, weightsArb, (total, weights) => {
        const parts = allocateScaled(total, weights);
        const totalWeight = weights.reduce((a, b) => a + b, 0n);
        parts.forEach((part, i) => {
          const ideal = (total * (weights[i] as bigint)) / totalWeight;
          const diff = part - ideal;
          expect(diff >= 0n && diff <= 1n).toBe(true);
        });
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: allocation is deterministic and sign-symmetric", () => {
    fc.assert(
      fc.property(scaledArb, weightsArb, (total, weights) => {
        const first = allocateScaled(total, weights);
        const second = allocateScaled(total, weights);
        expect(second).toEqual(first);
        const mirrored = allocateScaled(-total, weights);
        expect(mirrored).toEqual(first.map((p) => -p));
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: a zero weight is allocated nothing", () => {
    fc.assert(
      fc.property(positiveScaledArb, weightsArb, (total, weights) => {
        const withZero = [...weights, 0n];
        const parts = allocateScaled(total, withZero);
        expect(parts[parts.length - 1]).toBe(0n);
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: the Money wrapper preserves the exact-sum guarantee", () => {
    fc.assert(
      fc.property(scaledArb, weightsArb, (total, weights) => {
        const money = Money.fromScaled(total);
        const parts = allocate(money, weights);
        expect(Money.sum(parts).scaled).toBe(money.scaled);
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: refuses a negative weight, an empty weight list and an all-zero total weight", () => {
    fc.assert(
      fc.property(scaledArb, (total) => {
        expect(() => allocateScaled(total, [])).toThrow(RangeError);
        expect(() => allocateScaled(total, [1n, -1n])).toThrow(RangeError);
        expect(() => allocateScaled(total, [0n, 0n])).toThrow(RangeError);
      }),
      { numRuns: 50 },
    );
  });
});

describe("rounding — fuzz", () => {
  const modes: RoundingMode[] = ["HALF_UP", "HALF_EVEN", "DOWN", "UP", "FLOOR", "CEIL"];

  it("fuzz: rounding never moves a value by a whole step or more", () => {
    fc.assert(
      fc.property(
        scaledArb,
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(...modes),
        (scaled, decimals, mode) => {
          const rounded = roundMoney(Money.fromScaled(scaled), decimals, mode);
          const step = 10n ** BigInt(6 - decimals);
          const delta = rounded.scaled - scaled;
          expect(delta > -step && delta < step).toBe(true);
          expect(rounded.scaled % step).toBe(0n);
        },
      ),
      { numRuns: 600 },
    );
  });

  it("fuzz: rounding is monotonic — a larger input never rounds below a smaller one", () => {
    fc.assert(
      fc.property(
        scaledArb,
        scaledArb,
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(...modes),
        (a, b, decimals, mode) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const rlo = roundMoney(Money.fromScaled(lo), decimals, mode).scaled;
          const rhi = roundMoney(Money.fromScaled(hi), decimals, mode).scaled;
          expect(rlo <= rhi).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("fuzz: rounding is idempotent", () => {
    fc.assert(
      fc.property(
        scaledArb,
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(...modes),
        (scaled, decimals, mode) => {
          const once = roundMoney(Money.fromScaled(scaled), decimals, mode);
          const twice = roundMoney(once, decimals, mode);
          expect(twice.scaled).toBe(once.scaled);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("fuzz: DOWN and UP bracket every other mode", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 0, max: 5 }), (scaled, decimals) => {
        const value = Money.fromScaled(scaled);
        const down = roundMoney(value, decimals, "DOWN").scaled;
        const up = roundMoney(value, decimals, "UP").scaled;
        for (const mode of modes) {
          const r = roundMoney(value, decimals, mode).scaled;
          expect(r >= down && r <= up).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: HALF_EVEN lands on an even last digit at an exact tie", () => {
    fc.assert(
      fc.property(fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: 0, max: 5 }), (units, decimals) => {
        const step = 10n ** BigInt(6 - decimals);
        const tie = BigInt(units) * step + step / 2n;
        if (step === 1n) return;
        const rounded = roundMoney(Money.fromScaled(tie), decimals, "HALF_EVEN").scaled;
        expect((rounded / step) % 2n).toBe(0n);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: refuses a decimals argument outside [0, 6]", () => {
    fc.assert(
      fc.property(fc.integer().filter((n) => n < 0 || n > 6), (decimals) => {
        expect(() => roundMoney(Money.fromMajor("1.5"), decimals)).toThrow(RangeError);
      }),
      { numRuns: 100 },
    );
  });
});
