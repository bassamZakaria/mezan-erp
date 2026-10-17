import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildWeightedForecast, forecastMonthOf, weightedAmount } from "./forecast.js";
import type { Opportunity } from "./opportunity.js";

function deal(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    title: "فرصة",
    customerId: "cust-1",
    branchId: null,
    stageId: "stage-1",
    expectedValue: Money.fromMajor("1000"),
    probability: 50,
    expectedCloseDate: "2026-11-15",
    notes: null,
    ownerUserId: "rep-a",
    lostReason: null,
    lostNote: null,
    status: "open",
    createdAt: "2026-10-01T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

describe("weightedAmount", () => {
  it("multiplies exactly, with no float drift", () => {
    expect(weightedAmount(Money.fromMajor("0.10"), 30).toString()).toBe("0.030000");
    expect(weightedAmount(Money.fromMajor("1234567.89"), 12.5).toString()).toBe("154320.986250");
  });

  it("clamps the probability into 0..100 and rounds half up at the sixth decimal", () => {
    expect(weightedAmount(Money.fromMajor("100"), 150).toString()).toBe("100.000000");
    expect(weightedAmount(Money.fromMajor("100"), -5).toString()).toBe("0.000000");
    expect(weightedAmount(Money.fromScaled(5n), 10).toString()).toBe("0.000001");
  });
});

describe("forecastMonthOf", () => {
  it("reads the month of an ISO date and answers null for none or malformed", () => {
    expect(forecastMonthOf("2026-11-15")).toBe("2026-11");
    expect(forecastMonthOf(null)).toBeNull();
    expect(forecastMonthOf("soon")).toBeNull();
  });
});

describe("buildWeightedForecast", () => {
  it("buckets open deals by close month and rep, and totals reconcile to the unit", () => {
    const forecast = buildWeightedForecast([
      deal({ id: "1", expectedValue: Money.fromMajor("1000"), probability: 50 }),
      deal({ id: "2", expectedValue: Money.fromMajor("333.33"), probability: 33, ownerUserId: "rep-b" }),
      deal({ id: "3", expectedValue: Money.fromMajor("200"), probability: 10, expectedCloseDate: "2026-12-01" }),
      deal({ id: "4", expectedValue: Money.fromMajor("50"), probability: 90, expectedCloseDate: null, ownerUserId: null }),
    ]);

    expect(forecast.months.map((m) => m.month)).toEqual(["2026-11", "2026-12", null]);
    expect(forecast.months[0]?.owners.map((o) => o.ownerUserId)).toEqual(["rep-a", "rep-b"]);
    expect(forecast.total.count).toBe(4);
    expect(forecast.total.amount.toString()).toBe("1583.330000");
    expect(forecast.total.weighted.toString()).toBe("674.998900");

    const sumOf = (rows: readonly { weighted: Money }[]) => Money.sum(rows.map((r) => r.weighted));
    expect(sumOf(forecast.months).equals(forecast.total.weighted)).toBe(true);
    expect(sumOf(forecast.owners).equals(forecast.total.weighted)).toBe(true);
    expect(forecast.owners.map((o) => o.ownerUserId)).toEqual(["rep-a", "rep-b", null]);
  });

  it("ignores won and lost deals", () => {
    const forecast = buildWeightedForecast([deal({ status: "won" }), deal({ id: "2", status: "lost" })]);
    expect(forecast.total.count).toBe(0);
    expect(forecast.months).toEqual([]);
  });
});
