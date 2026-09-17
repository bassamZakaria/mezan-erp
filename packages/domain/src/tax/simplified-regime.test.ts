import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  SIMPLIFIED_REGIME_SCHEDULES,
  bandForTurnover,
  simplifiedRegimeScheduleOn,
} from "./simplified-regime-schedule.js";
import { computeClientConcentration, computeSimplifiedRegimeLiability, taxOnBase } from "./simplified-regime.js";
import {
  InvalidSimplifiedRegimeRecordError,
  recordSimplifiedRegime,
  simplifiedRegimeActiveOn,
  simplifiedRegimeFlags,
} from "./simplified-regime-election.js";
import { vatFilingDueDate, vatPeriodModeFor, vatPeriodModeOfWindow, vatPeriodWindows } from "./vat-filing.js";

const SCHEDULE = SIMPLIFIED_REGIME_SCHEDULES[0]!;

describe("the statutory table is dated and attributed, not asserted", () => {
  it("does not exist before the law came into force on 1 March 2025", () => {
    expect(simplifiedRegimeScheduleOn("2025-02-28")).toBeNull();
    expect(simplifiedRegimeScheduleOn("2025-03-01")?.id).toBe("eg-law-6-2025");
  });

  it("names an article behind every figure, so a wrong number can be traced to its source", () => {
    for (const band of SCHEDULE.bands) expect(band.source).not.toBe("");
    for (const value of [
      SCHEDULE.turnoverCeiling,
      SCHEDULE.concentration,
      SCHEDULE.overshootGrace,
      SCHEDULE.irrevocableYears,
      SCHEDULE.vatFiling,
      SCHEDULE.normalIncomeTaxPercent,
    ]) {
      expect(value.source).not.toBe("");
    }
  });

  it("reads the bands inclusive-lower / exclusive-upper, so a boundary turnover lands in the higher band", () => {
    expect(bandForTurnover(SCHEDULE, Money.fromMajor("499999.99"))?.ratePercent).toBe(0.4);
    expect(bandForTurnover(SCHEDULE, Money.fromMajor("500000"))?.ratePercent).toBe(0.5);
    expect(bandForTurnover(SCHEDULE, Money.fromMajor("2000000"))?.ratePercent).toBe(0.75);
    expect(bandForTurnover(SCHEDULE, Money.fromMajor("3000000"))?.ratePercent).toBe(1);
    expect(bandForTurnover(SCHEDULE, Money.fromMajor("10000000"))?.ratePercent).toBe(1.5);
    expect(bandForTurnover(SCHEDULE, Money.fromMajor("20000000"))).toBeNull();
  });
});

describe("the charge is on turnover, computed exactly", () => {
  it("multiplies at the TAX_COMPUTATION boundary without a float in the path", () => {
    // 1,234,567.89 × 0.5% = 6,172.83945 → HALF_UP at 1e-6 is exact, no drift.
    expect(taxOnBase(Money.fromMajor("1234567.89"), 0.5).toString()).toBe("6172.839450");
  });

  it("charges a small trader 0.4% of turnover", () => {
    const liability = computeSimplifiedRegimeLiability(SCHEDULE, Money.fromMajor("400000"));
    expect(liability.standing).toBe("within_ceiling");
    expect(liability.ratePercent).toBe(0.4);
    expect(liability.tax?.toString()).toBe("1600.000000");
    expect(liability.estimate).toBe(true);
  });

  it("grants the one-year grace at the top rate for an overshoot inside the tolerance", () => {
    // 20m + 20% = 24m is the far edge of the grace.
    const inGrace = computeSimplifiedRegimeLiability(SCHEDULE, Money.fromMajor("24000000"));
    expect(inGrace.standing).toBe("grace_overshoot");
    expect(inGrace.ratePercent).toBe(1.5);
    expect(inGrace.tax?.toString()).toBe("360000.000000");
  });

  it("refuses to price turnover beyond the grace rather than returning a plausible number", () => {
    const beyond = computeSimplifiedRegimeLiability(SCHEDULE, Money.fromMajor("24000000.01"));
    expect(beyond.standing).toBe("over_ceiling");
    expect(beyond.tax).toBeNull();
  });
});

describe("the ≥90% concentration exclusion is measured and shown, never decided", () => {
  it("flags MAY-disqualify when the largest two clients carry the threshold share", () => {
    const reading = computeClientConcentration(SCHEDULE, [
      { customerId: "C1", customerName: "عميل ١", turnover: Money.fromMajor("500000") },
      { customerId: "C2", customerName: "عميل ٢", turnover: Money.fromMajor("400000") },
      { customerId: "C3", customerName: "عميل ٣", turnover: Money.fromMajor("100000") },
    ]);
    expect(reading.topSharePercent).toBe(90);
    expect(reading.mayDisqualify).toBe(true);
    expect(reading.topClients.map((client) => client.customerId)).toEqual(["C1", "C2"]);
  });

  it("does not flag a spread book", () => {
    const reading = computeClientConcentration(SCHEDULE, [
      { customerId: "C1", customerName: "عميل ١", turnover: Money.fromMajor("400000") },
      { customerId: "C2", customerName: "عميل ٢", turnover: Money.fromMajor("300000") },
      { customerId: "C3", customerName: "عميل ٣", turnover: Money.fromMajor("300000") },
    ]);
    expect(reading.topSharePercent).toBe(70);
    expect(reading.mayDisqualify).toBe(false);
  });

  it("reads no sales as no concentration, not as 100% of nothing", () => {
    const reading = computeClientConcentration(SCHEDULE, []);
    expect(reading.topSharePercent).toBe(0);
    expect(reading.mayDisqualify).toBe(false);
  });
});

describe("the election is RECORDED, never performed", () => {
  it("refuses an active regime with no Form 1/10 reference behind it", () => {
    expect(() => recordSimplifiedRegime({ state: "active", electedOn: "2025-06-01" })).toThrow(
      InvalidSimplifiedRegimeRecordError,
    );
  });

  it("derives the five-year irrevocability window from the date that was filed", () => {
    const election = recordSimplifiedRegime({
      state: "active",
      electedOn: "2025-06-01",
      form110Reference: "1/10-2025-0042",
      eInvoicingJoinedOn: "2025-01-15",
      recordedAt: "2025-06-02T09:00:00.000Z",
      recordedBy: "USR-1",
    });
    expect(election.irrevocableUntil).toBe("2030-05-31");
    expect(election.state).toBe("active");
  });

  it("records a withdrawal made inside the five years and FLAGS it, rather than refusing the fact", () => {
    const election = recordSimplifiedRegime({
      state: "withdrawn",
      electedOn: "2025-06-01",
      form110Reference: "1/10-2025-0042",
      withdrawnOn: "2027-01-01",
      form111Reference: "1/11-2027-0007",
      eInvoicingJoinedOn: "2025-01-15",
    });
    const flags = simplifiedRegimeFlags(election, SCHEDULE).map((flag) => flag.key);
    expect(flags).toContain("withdrawnInsideIrrevocability");
  });

  it("flags a regime record with no e-invoicing join date — it is a condition of entry", () => {
    const election = recordSimplifiedRegime({
      state: "active",
      electedOn: "2025-06-01",
      form110Reference: "1/10-2025-0042",
    });
    expect(simplifiedRegimeFlags(election, SCHEDULE).map((flag) => flag.key)).toContain("eInvoicingMissing");
  });

  it("binds only days on or after the election, and stops at the withdrawal", () => {
    const election = recordSimplifiedRegime({
      state: "withdrawn",
      electedOn: "2025-06-01",
      form110Reference: "1/10-2025-0042",
      withdrawnOn: "2027-01-01",
      form111Reference: "1/11-2027-0007",
    });
    expect(simplifiedRegimeActiveOn(election, "2025-05-31")).toBe(false);
    expect(simplifiedRegimeActiveOn(election, "2026-03-01")).toBe(true);
    expect(simplifiedRegimeActiveOn(election, "2027-01-02")).toBe(false);
  });
});

describe("the VAT return turns quarterly while the regime is on the books", () => {
  const active = recordSimplifiedRegime({
    state: "active",
    electedOn: "2025-06-01",
    form110Reference: "1/10-2025-0042",
  });

  it("files monthly with no regime recorded", () => {
    expect(vatPeriodModeFor(null, SCHEDULE, "2026-03-31")).toBe("monthly");
  });

  it("files quarterly inside the regime", () => {
    expect(vatPeriodModeFor(active, SCHEDULE, "2026-03-31")).toBe("quarterly");
    expect(vatPeriodModeFor(active, SCHEDULE, "2025-03-31")).toBe("monthly");
  });

  it("falls due one month after the quarter ends", () => {
    expect(vatFilingDueDate("2026-03-31", "quarterly", SCHEDULE)).toBe("2026-04-30");
    expect(vatFilingDueDate("2026-12-31", "quarterly", SCHEDULE)).toBe("2027-01-31");
  });

  it("does not invent a monthly deadline it has no source for", () => {
    expect(vatFilingDueDate("2026-03-31", "monthly", SCHEDULE)).toBeNull();
  });

  it("lays the year out in four windows, not twelve", () => {
    const windows = vatPeriodWindows(2026, "quarterly", SCHEDULE);
    expect(windows).toHaveLength(4);
    expect(windows[0]).toEqual({ periodFrom: "2026-01-01", periodTo: "2026-03-31", dueDate: "2026-04-30" });
    expect(vatPeriodWindows(2026, "monthly", SCHEDULE)).toHaveLength(12);
  });

  it("reads a recorded window's own mode off the window, so nothing can disagree with it", () => {
    expect(vatPeriodModeOfWindow({ periodFrom: "2026-01-01", periodTo: "2026-03-31" })).toBe("quarterly");
    expect(vatPeriodModeOfWindow({ periodFrom: "2026-01-01", periodTo: "2026-01-31" })).toBe("monthly");
  });
});
