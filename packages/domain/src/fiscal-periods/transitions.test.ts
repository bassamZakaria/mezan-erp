import { describe, it, expect } from "vitest";
import type { FiscalPeriod } from "./fiscal-period.js";
import { assertOpenForPosting, closePeriod, lockPeriod, reopenPeriod } from "./transitions.js";
import { InvalidPeriodTransitionError, PeriodNotOpenForPostingError } from "./errors.js";

function period(status: FiscalPeriod["status"]): FiscalPeriod {
  return { id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status };
}

describe("fiscal period state transitions", () => {
  it("closePeriod: open -> closed", () => {
    expect(closePeriod(period("open")).status).toBe("closed");
  });

  it("closePeriod rejects a period that is already closed or locked", () => {
    expect(() => closePeriod(period("closed"))).toThrow(InvalidPeriodTransitionError);
    expect(() => closePeriod(period("locked"))).toThrow(InvalidPeriodTransitionError);
  });

  it("reopenPeriod: closed -> open", () => {
    expect(reopenPeriod(period("closed")).status).toBe("open");
  });

  it("reopenPeriod rejects an open or locked period", () => {
    expect(() => reopenPeriod(period("open"))).toThrow(InvalidPeriodTransitionError);
    expect(() => reopenPeriod(period("locked"))).toThrow(InvalidPeriodTransitionError);
  });

  it("lockPeriod: closed -> locked", () => {
    expect(lockPeriod(period("closed")).status).toBe("locked");
  });

  it("lockPeriod rejects locking directly from open (must close first)", () => {
    expect(() => lockPeriod(period("open"))).toThrow(InvalidPeriodTransitionError);
  });

  it("lockPeriod rejects a period that is already locked (terminal, no unlock)", () => {
    expect(() => lockPeriod(period("locked"))).toThrow(InvalidPeriodTransitionError);
  });

  it("assertOpenForPosting passes silently for an open period", () => {
    expect(() => assertOpenForPosting(period("open"))).not.toThrow();
  });

  it("assertOpenForPosting throws PeriodNotOpenForPostingError for closed or locked periods", () => {
    expect(() => assertOpenForPosting(period("closed"))).toThrow(PeriodNotOpenForPostingError);
    expect(() => assertOpenForPosting(period("locked"))).toThrow(PeriodNotOpenForPostingError);
  });

  it("full lifecycle: open -> closed -> locked is terminal", () => {
    let p = period("open");
    p = closePeriod(p);
    p = lockPeriod(p);
    expect(p.status).toBe("locked");
    expect(() => reopenPeriod(p)).toThrow(InvalidPeriodTransitionError);
    expect(() => closePeriod(p)).toThrow(InvalidPeriodTransitionError);
    expect(() => lockPeriod(p)).toThrow(InvalidPeriodTransitionError);
  });
});
