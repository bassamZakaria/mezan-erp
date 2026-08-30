import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SEQUENCE_DEFINITIONS,
  applySequenceOverride,
  formatSequenceNumber,
  getSequenceDefinition,
  type SequenceCode,
} from "./sequences.js";
import { NextNumberService, type SequenceStore } from "./next-number.js";

const codeArb = fc.constantFrom(...(SEQUENCE_DEFINITIONS.map((d) => d.code) as SequenceCode[]));

/** An in-memory counter store with the same key shape the SQLite one uses. */
function memoryStore(): SequenceStore & { keys(): string[] } {
  const counters = new Map<string, number>();
  return {
    async increment(code, period, scope) {
      const key = `${code}|${period ?? ""}|${scope ?? ""}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    keys: () => [...counters.keys()],
  };
}

describe("document numbering — fuzz", () => {
  it("fuzz: a sequence never repeats a number, however many are drawn", async () => {
    await fc.assert(
      fc.asyncProperty(codeArb, fc.integer({ min: 1, max: 200 }), async (code, draws) => {
        const service = new NextNumberService(memoryStore());
        const seen = new Set<string>();
        for (let i = 0; i < draws; i++) {
          const result = await service.next(code, { year: 2026, branchId: "BR-1", branchCode: "CAI" });
          expect(result.value).toBe(i + 1);
          expect(seen.has(result.formatted)).toBe(false);
          seen.add(result.formatted);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("fuzz: an annual-reset sequence restarts at 1 in a new year and never collides across years", async () => {
    await fc.assert(
      fc.asyncProperty(
        codeArb,
        fc.integer({ min: 2020, max: 2035 }),
        fc.integer({ min: 1, max: 20 }),
        async (code, year, draws) => {
          const def = getSequenceDefinition(code);
          const service = new NextNumberService(memoryStore());

          for (let i = 0; i < draws; i++) await service.next(code, { year });
          const nextYear = await service.next(code, { year: year + 1 });

          expect(nextYear.value).toBe(def.annualReset ? 1 : draws + 1);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("fuzz: a branch-scoped sequence counts per branch and carries the branch in the number", async () => {
    await fc.assert(
      fc.asyncProperty(codeArb, fc.integer({ min: 1, max: 15 }), async (code, draws) => {
        const def = getSequenceDefinition(code);
        const service = new NextNumberService(memoryStore());

        for (let i = 0; i < draws; i++) {
          await service.next(code, { year: 2026, branchId: "BR-CAIRO", branchCode: "CAI" });
        }
        const other = await service.next(code, { year: 2026, branchId: "BR-ALEX", branchCode: "ALX" });

        if (def.branchScoped) {
          expect(other.value).toBe(1);
          expect(other.formatted).toContain("ALX-");
        } else {
          expect(other.value).toBe(draws + 1);
          expect(other.formatted).not.toContain("ALX-");
        }
      }),
      { numRuns: 150 },
    );
  });

  it("fuzz: the formatted number always starts with the prefix and pads to the configured width", () => {
    fc.assert(
      fc.property(codeArb, fc.integer({ min: 1, max: 10 ** 7 }), (code, value) => {
        const def = getSequenceDefinition(code);
        const formatted = formatSequenceNumber(def, value, "CAI");
        expect(formatted.startsWith(def.prefix)).toBe(true);
        if (def.suffix) expect(formatted.endsWith(def.suffix)).toBe(true);
        const digits = formatted.replace(/\D/g, "").slice(-Math.max(def.padLength, String(value).length));
        expect(Number(digits)).toBe(value);
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: formatting is strictly ordered — a larger counter never sorts before a smaller one", () => {
    fc.assert(
      fc.property(codeArb, fc.integer({ min: 1, max: 9998 }), (code, value) => {
        const def = getSequenceDefinition(code);
        const lower = formatSequenceNumber(def, value, "CAI");
        const higher = formatSequenceNumber(def, value + 1, "CAI");
        expect(lower.localeCompare(higher)).toBeLessThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: an override changes only the fields it names", () => {
    fc.assert(
      fc.property(
        codeArb,
        fc.record(
          {
            prefix: fc.string({ minLength: 1, maxLength: 6 }),
            padLength: fc.integer({ min: 1, max: 10 }),
            annualReset: fc.boolean(),
            branchScoped: fc.boolean(),
          },
          { requiredKeys: [] },
        ),
        (code, override) => {
          const base = getSequenceDefinition(code);
          const merged = applySequenceOverride(base, override);
          expect(merged.code).toBe(base.code);
          expect(merged.prefix).toBe(override.prefix ?? base.prefix);
          expect(merged.padLength).toBe(override.padLength ?? base.padLength);
          expect(merged.annualReset).toBe(override.annualReset ?? base.annualReset);
          expect(merged.branchScoped).toBe(override.branchScoped ?? base.branchScoped);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("fuzz: an unknown sequence code is refused rather than silently numbered", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !SEQUENCE_DEFINITIONS.some((d) => d.code === s)),
        (unknown) => {
          expect(() => getSequenceDefinition(unknown)).toThrow(RangeError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fuzz: concurrent draws from one sequence never hand out the same number twice", async () => {
    await fc.assert(
      fc.asyncProperty(codeArb, fc.integer({ min: 2, max: 50 }), async (code, callers) => {
        const service = new NextNumberService(memoryStore());
        const results = await Promise.all(
          Array.from({ length: callers }, () => service.next(code, { year: 2026, branchId: "BR-1", branchCode: "CAI" })),
        );
        const values = results.map((r) => r.value).sort((a, b) => a - b);
        expect(values).toEqual(Array.from({ length: callers }, (_, i) => i + 1));
      }),
      { numRuns: 100 },
    );
  });

  it("every defined sequence has a non-empty prefix and a sane pad width", () => {
    for (const def of SEQUENCE_DEFINITIONS) {
      expect(def.prefix.length).toBeGreaterThan(0);
      expect(def.padLength).toBeGreaterThanOrEqual(1);
      expect(def.padLength).toBeLessThanOrEqual(12);
    }
    const codes = SEQUENCE_DEFINITIONS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
