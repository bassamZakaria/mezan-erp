import { describe, expect, it } from "vitest";
import { InvalidPeriodTransitionError, PeriodNotOpenForPostingError } from "./errors.js";
import { FiscalPeriodTransition, fiscalPeriodLabel } from "./labels.js";
import { assertOpenForPosting, closePeriod, lockPeriod, reopenPeriod } from "./transitions.js";
import type { FiscalPeriod, FiscalPeriodStatus } from "./fiscal-period.js";

const RAW = /fp-2026-04|"close"|"reopen"|"lock"|"open"|"closed"|"locked"/;

function april(status: FiscalPeriodStatus): FiscalPeriod {
  return { id: "fp-2026-04", year: 2026, periodNumber: 4, startDate: "2026-04-01", endDate: "2026-04-30", status };
}

function thrownBy(act: () => unknown): Error & { messageEn?: string } {
  try {
    act();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("nothing was thrown");
}

describe("fiscal period wording", () => {
  it("names a period by its month and year in both languages", () => {
    expect(fiscalPeriodLabel(april("open"))).toEqual({ ar: "أبريل 2026", en: "April 2026" });
    expect(fiscalPeriodLabel({ id: "fp-2026-13", year: 2026, periodNumber: 13 })).toEqual({ ar: "الفترة 13 لسنة 2026", en: "period 13 of 2026" });
  });

  it("a posting into a closed or locked month is refused by its name and its Arabic status, never its id", () => {
    const closed = thrownBy(() => assertOpenForPosting(april("closed")));
    expect(closed).toBeInstanceOf(PeriodNotOpenForPostingError);
    expect(closed.message).toBe("الفترة المحاسبية «أبريل 2026» مغلقة ولا تسمح بالترحيل.");
    expect(closed.messageEn).toBe("Fiscal period April 2026 is closed and does not accept postings.");

    const locked = thrownBy(() => assertOpenForPosting(april("locked")));
    expect(locked.message).toBe("الفترة المحاسبية «أبريل 2026» مقفلة ولا تسمح بالترحيل.");
    for (const error of [closed, locked]) expect(error.message).not.toMatch(RAW);
  });

  it("a refused transition names the action and the status in Arabic", () => {
    const cases: readonly [() => unknown, FiscalPeriodTransition, string, string][] = [
      [() => closePeriod(april("closed")), FiscalPeriodTransition.Close, "لا يمكن إقفال الفترة المحاسبية «أبريل 2026» وهي مغلقة.", "Fiscal period April 2026 cannot be closed while it is closed."],
      [() => reopenPeriod(april("locked")), FiscalPeriodTransition.Reopen, "لا يمكن إعادة فتح الفترة المحاسبية «أبريل 2026» وهي مقفلة.", "Fiscal period April 2026 cannot be reopened while it is locked."],
      [() => lockPeriod(april("open")), FiscalPeriodTransition.Lock, "لا يمكن قفل الفترة المحاسبية «أبريل 2026» نهائياً وهي مفتوحة.", "Fiscal period April 2026 cannot be locked while it is open."],
    ];
    for (const [act, transition, ar, en] of cases) {
      const error = thrownBy(act);
      expect(error).toBeInstanceOf(InvalidPeriodTransitionError);
      expect((error as InvalidPeriodTransitionError).attemptedTransition).toBe(transition);
      expect(error.message).toBe(ar);
      expect(error.messageEn).toBe(en);
      expect(error.message).not.toMatch(RAW);
    }
  });
});

describe("a posting refusal raised with only the period id", () => {
  it("still names the month when the id is a generated one", () => {
    const error = new PeriodNotOpenForPostingError("fp-2026-10", "closed");
    expect(error.message).toBe("الفترة المحاسبية «أكتوبر 2026» مغلقة ولا تسمح بالترحيل.");
    expect(error.messageEn).toBe("Fiscal period October 2026 is closed and does not accept postings.");
    expect(error.periodId).toBe("fp-2026-10");
  });

  it("quotes the id itself when it is not one it can read a month from", () => {
    const error = new PeriodNotOpenForPostingError("P1", "locked");
    expect(error.message).toBe("الفترة المحاسبية «P1» مقفلة ولا تسمح بالترحيل.");
    expect(error.periodId).toBe("P1");
  });
});

