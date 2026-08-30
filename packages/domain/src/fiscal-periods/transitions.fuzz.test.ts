import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { FiscalPeriod, FiscalPeriodStatus } from "./fiscal-period.js";
import { isPostingAllowed } from "./fiscal-period.js";
import { InvalidPeriodTransitionError, PeriodNotOpenForPostingError } from "./errors.js";
import { assertOpenForPosting, closePeriod, lockPeriod, reopenPeriod } from "./transitions.js";
import { buildFiscalYearPeriods } from "./generate-fiscal-year.js";

type Action = "close" | "reopen" | "lock";

const statusArb = fc.constantFrom<FiscalPeriodStatus>("open", "closed", "locked");
const actionArb = fc.constantFrom<Action>("close", "reopen", "lock");

function periodOf(status: FiscalPeriodStatus): FiscalPeriod {
  return {
    id: "FP-2026-01",
    name: "يناير 2026",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    status,
  } as FiscalPeriod;
}

function apply(period: FiscalPeriod, action: Action): FiscalPeriod {
  if (action === "close") return closePeriod(period);
  if (action === "reopen") return reopenPeriod(period);
  return lockPeriod(period);
}

const LEGAL: Record<FiscalPeriodStatus, Partial<Record<Action, FiscalPeriodStatus>>> = {
  open: { close: "closed" },
  closed: { reopen: "open", lock: "locked" },
  locked: {},
};

describe("fiscal-period lifecycle — fuzz", () => {
  it("fuzz: only the three documented transitions are ever accepted", () => {
    fc.assert(
      fc.property(statusArb, actionArb, (status, action) => {
        const expected = LEGAL[status][action];
        if (expected) {
          expect(apply(periodOf(status), action).status).toBe(expected);
        } else {
          expect(() => apply(periodOf(status), action)).toThrow(InvalidPeriodTransitionError);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: locked is terminal — no sequence of actions ever leaves it", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { minLength: 1, maxLength: 20 }), (actions) => {
        let period = periodOf("locked");
        for (const action of actions) {
          expect(() => apply(period, action)).toThrow(InvalidPeriodTransitionError);
          expect(period.status).toBe("locked");
        }
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: any legal walk ends in a reachable state and never posts from a non-open one", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { minLength: 1, maxLength: 25 }), (actions) => {
        let period = periodOf("open");
        for (const action of actions) {
          try {
            period = apply(period, action);
          } catch (error) {
            expect(error).toBeInstanceOf(InvalidPeriodTransitionError);
          }
          expect(["open", "closed", "locked"]).toContain(period.status);
          if (period.status === "open") {
            expect(() => assertOpenForPosting(period)).not.toThrow();
            expect(isPostingAllowed(period)).toBe(true);
          } else {
            expect(() => assertOpenForPosting(period)).toThrow(PeriodNotOpenForPostingError);
            expect(isPostingAllowed(period)).toBe(false);
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: a transition never mutates the period it was handed", () => {
    fc.assert(
      fc.property(statusArb, actionArb, (status, action) => {
        const period = periodOf(status);
        const before = { ...period };
        try {
          apply(period, action);
        } catch {
          // the refusal is asserted elsewhere; here only immutability matters
        }
        expect(period).toEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: close then reopen returns the identical period, so the round trip loses nothing", () => {
    const period = periodOf("open");
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (rounds) => {
        let current = period;
        for (let i = 0; i < rounds; i++) current = reopenPeriod(closePeriod(current));
        expect(current).toEqual(period);
      }),
      { numRuns: 100 },
    );
  });

  it("fuzz: a generated fiscal year covers it exactly — twelve periods, no gap, no overlap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1990, max: 2100 }), (year) => {
        const periods = buildFiscalYearPeriods(year, (y, n) => `FP-${y}-${String(n).padStart(2, "0")}`);
        expect(periods).toHaveLength(12);
        expect(new Set(periods.map((p) => p.id)).size).toBe(12);
        expect(periods[0]?.startDate).toBe(`${year}-01-01`);
        expect(periods[11]?.endDate).toBe(`${year}-12-31`);

        for (let i = 0; i < periods.length; i++) {
          const period = periods[i] as FiscalPeriod;
          expect(period.status).toBe("open");
          expect(period.startDate <= period.endDate).toBe(true);
          if (i > 0) {
            const previous = periods[i - 1] as FiscalPeriod;
            const dayAfter = new Date(`${previous.endDate}T00:00:00.000Z`);
            dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
            expect(period.startDate).toBe(dayAfter.toISOString().slice(0, 10));
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: February is 29 days exactly in a leap year and 28 otherwise", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1990, max: 2100 }), (year) => {
        const periods = buildFiscalYearPeriods(year, (y, n) => `FP-${y}-${n}`);
        const february = periods[1] as FiscalPeriod;
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        expect(february.endDate).toBe(`${year}-02-${leap ? 29 : 28}`);
      }),
      { numRuns: 200 },
    );
  });
});
