import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { PlanKind, type Plan, type PlanRepository } from "./plan.js";
import {
  addPeriod, applyRenewal, settledPeriodEnd, startSubscription, renewSubscription, changePlan, markPastDue,
  suspendSubscription, resumeSubscription, cancelSubscription, billingAnchorDayOf, inferBillingAnchorDay, setBillingAnchorDay, anchorIsUtcDayOfCreation,
  type Subscription, type SubscriptionRepository,
} from "./subscription.js";
import {
  InvalidSubscriptionError, InvalidSubscriptionTransitionError, PlanNotFoundError,
  PlanRetiredError, SubscriptionNotFoundError, TenantAlreadySubscribedError,
} from "./errors.js";

const NOW = "2026-01-31T10:00:00.000Z";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core", kind: PlanKind.Paid, quotas: {}, modules: ["accounting", "sales"], features: {},
    seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
    priceMonthly: Money.fromMajor("490"), priceYearly: Money.fromMajor("4900"),
    trialDays: 14, isPublic: true, sortOrder: 1, status: "active", createdAt: NOW, ...overrides,
  };
}

function plans(...items: Plan[]): PlanRepository {
  const rows = new Map(items.map((p) => [p.id, p]));
  return {
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(code) { return [...rows.values()].find((p) => p.code === code) ?? null; },
    async list() { return [...rows.values()]; },
    async save(p) { rows.set(p.id, p); },
  };
}

function subs(): SubscriptionRepository & { rows: Map<string, Subscription> } {
  const rows = new Map<string, Subscription>();
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findLiveByTenant(tenantId) {
      return [...rows.values()].find((s) => s.tenantId === tenantId && s.status !== "cancelled") ?? null;
    },
    async listByTenant(tenantId) { return [...rows.values()].filter((s) => s.tenantId === tenantId); },
    async hasLiveByPlan(planId) {
      return [...rows.values()].some((s) => s.planId === planId && s.status !== "cancelled");
    },
    async listByPlan(planId) {
      return [...rows.values()].filter((s) => s.planId === planId && s.status !== "cancelled");
    },
    async save(s) { rows.set(s.id, s); },
  };
}

describe("addPeriod", () => {
  it("adds a calendar month, clamping to the last day", () => {
    expect(addPeriod("2026-01-31T10:00:00.000Z", "monthly")).toBe("2026-02-28T10:00:00.000Z");
    expect(addPeriod("2026-03-15T00:00:00.000Z", "monthly")).toBe("2026-04-15T00:00:00.000Z");
  });
  it("carries December into January of the next year, at midday and just after midnight in Cairo", () => {
    expect(addPeriod("2026-12-31T10:00:00.000Z", "monthly")).toBe("2027-01-31T10:00:00.000Z");
    expect(addPeriod("2026-12-30T22:30:00.000Z", "monthly")).toBe("2027-01-30T22:30:00.000Z");
    expect(settledPeriodEnd({ currentPeriodStart: "2026-12-30T22:30:00.000Z", currentPeriodEnd: "2027-01-30T22:30:00.000Z", billingCycle: "monthly" })).toBe("2027-01-30T22:30:00.000Z");
  });
  it("adds a calendar year, clamping 29 February", () => {
    expect(addPeriod("2028-02-29T00:00:00.000Z", "yearly")).toBe("2029-02-28T00:00:00.000Z");
    expect(addPeriod("2026-09-13T00:00:00.000Z", "yearly")).toBe("2027-09-13T00:00:00.000Z");
  });
});

const base = { id: "S1", tenantId: "T1", planId: "P1", billingCycle: "monthly" as const, now: NOW };

describe("startSubscription", () => {
  it("starts a trial when asked and the plan allows one", async () => {
    const repo = subs();
    const s = await startSubscription({ ...base, trial: true }, repo, plans(plan()));
    expect(s).toMatchObject({
      status: "trialing", planId: "P1", billingCycle: "monthly", addOnModules: [], extraSeats: 0,
      extraBranches: 0, extraWarehouses: 0, currentPeriodStart: NOW,
      currentPeriodEnd: "2026-02-28T10:00:00.000Z", trialEndsAt: "2026-02-14T10:00:00.000Z",
      graceDays: 7, cancelledAt: null, createdAt: NOW, updatedAt: NOW,
    });
  });

  it("normalises now to the toISOString shape, even without milliseconds", async () => {
    const s = await startSubscription({ ...base, now: "2026-01-31T10:00:00Z" }, subs(), plans(plan()));
    expect(s.currentPeriodStart).toBe("2026-01-31T10:00:00.000Z");
  });

  it("starts active when not a trial, or when the plan has no trial days", async () => {
    expect((await startSubscription(base, subs(), plans(plan()))).status).toBe("active");
    const s = await startSubscription({ ...base, trial: true }, subs(), plans(plan({ trialDays: 0 })));
    expect(s.status).toBe("active");
    expect(s.trialEndsAt).toBeNull();
  });

  it("carries add-ons, extra capacity and a yearly period", async () => {
    const s = await startSubscription(
      { ...base, billingCycle: "yearly", addOnModules: ["hr", "hr"], extraSeats: 2, extraBranches: 1, extraWarehouses: 3, graceDays: 10 },
      subs(), plans(plan()),
    );
    expect(s.addOnModules).toEqual(["hr"]);
    expect(s.extraSeats).toBe(2);
    expect(s.graceDays).toBe(10);
    expect(s.currentPeriodEnd).toBe("2027-01-31T10:00:00.000Z");
  });

  it("refuses an unknown add-on and negative capacity", async () => {
    await expect(startSubscription({ ...base, addOnModules: ["telepathy"] }, subs(), plans(plan()))).rejects.toThrow(InvalidSubscriptionError);
    await expect(startSubscription({ ...base, extraSeats: -1 }, subs(), plans(plan()))).rejects.toThrow(InvalidSubscriptionError);
  });

  it("accumulates every validation reason at once, rather than failing on the first", async () => {
    await expect(startSubscription({ ...base, addOnModules: ["telepathy"], extraSeats: -1 }, subs(), plans(plan())))
      .rejects.toMatchObject({ reasons: expect.arrayContaining([
        expect.stringContaining("telepathy"), expect.stringContaining("المقاعد الإضافية"),
      ]) });
  });

  it("refuses a missing or retired plan", async () => {
    await expect(startSubscription(base, subs(), plans())).rejects.toThrow(PlanNotFoundError);
    await expect(startSubscription(base, subs(), plans(plan({ status: "retired" })))).rejects.toThrow(PlanRetiredError);
  });

  it("validation errors win over a missing plan, since they are checked before any repository read", async () => {
    await expect(startSubscription({ ...base, extraSeats: -1 }, subs(), plans())).rejects.toThrow(InvalidSubscriptionError);
  });

  it("refuses a second live subscription for the same tenant, but allows one after cancellation", async () => {
    const repo = subs();
    await startSubscription(base, repo, plans(plan()));
    await expect(startSubscription({ ...base, id: "S2" }, repo, plans(plan()))).rejects.toThrow(TenantAlreadySubscribedError);
    await cancelSubscription({ id: "S1", now: NOW }, repo);
    expect((await startSubscription({ ...base, id: "S2" }, repo, plans(plan()))).id).toBe("S2");
  });
});

describe("lifecycle", () => {
  const LATER = "2026-03-05T00:00:00.000Z";
  async function started(status: Subscription["status"], trial = false) {
    const repo = subs();
    const s = await startSubscription({ ...base, trial }, repo, plans(plan()));
    repo.rows.set(s.id, { ...s, status });
    return repo;
  }

  it("renew: trialing → active and rolls the period from the old end, ahead of it", async () => {
    const BEFORE_END = "2026-02-20T00:00:00.000Z";
    const repo = await started("trialing", true);
    const s = await renewSubscription({ id: "S1", now: BEFORE_END }, repo);
    expect(s.status).toBe("active");
    expect(s.trialEndsAt).toBeNull();
    expect(s.currentPeriodStart).toBe("2026-02-28T10:00:00.000Z");
    expect(s.currentPeriodEnd).toBe("2026-03-31T10:00:00.000Z");
    expect(s.updatedAt).toBe(BEFORE_END);
  });

  it("renew: past_due → active; active → active; cancelled refused", async () => {
    expect((await renewSubscription({ id: "S1", now: LATER }, await started("past_due"))).status).toBe("active");
    expect((await renewSubscription({ id: "S1", now: LATER }, await started("active"))).status).toBe("active");
    await expect(renewSubscription({ id: "S1", now: LATER }, await started("cancelled"))).rejects.toThrow(InvalidSubscriptionTransitionError);
    await expect(renewSubscription({ id: "S1", now: LATER }, await started("suspended"))).rejects.toThrow(InvalidSubscriptionTransitionError);
  });

  it("renew on a lapsed subscription starts the new period at now, not at the old end", async () => {
    const repo = await started("active");
    const s = await renewSubscription({ id: "S1", now: "2026-06-01T00:00:00.000Z" }, repo);
    expect(s.currentPeriodStart).toBe("2026-06-01T00:00:00.000Z");
    expect(s.currentPeriodEnd).toBe("2026-07-01T00:00:00.000Z");
  });

  it("markPastDue only after the period end, only from active", async () => {
    await expect(markPastDue({ id: "S1", now: "2026-02-01T00:00:00.000Z" }, await started("active"))).rejects.toThrow(InvalidSubscriptionError);
    expect((await markPastDue({ id: "S1", now: LATER }, await started("active"))).status).toBe("past_due");
    await expect(markPastDue({ id: "S1", now: LATER }, await started("trialing", true))).rejects.toThrow(InvalidSubscriptionTransitionError);
  });

  it("markPastDue refuses a now that is not an ISO-8601 timestamp", async () => {
    await expect(markPastDue({ id: "S1", now: "not a date" }, await started("active"))).rejects.toThrow(InvalidSubscriptionError);
  });

  it("suspend from active or past_due, resume only from suspended", async () => {
    expect((await suspendSubscription({ id: "S1", now: LATER }, await started("active"))).status).toBe("suspended");
    expect((await suspendSubscription({ id: "S1", now: LATER }, await started("past_due"))).status).toBe("suspended");
    await expect(suspendSubscription({ id: "S1", now: LATER }, await started("trialing", true))).rejects.toThrow(InvalidSubscriptionTransitionError);
    expect((await resumeSubscription({ id: "S1", now: LATER }, await started("suspended"))).status).toBe("active");
    await expect(resumeSubscription({ id: "S1", now: LATER }, await started("active"))).rejects.toThrow(InvalidSubscriptionTransitionError);
  });

  it("cancel from any live state stamps cancelledAt; cancelled is terminal", async () => {
    for (const status of ["trialing", "active", "past_due", "suspended"] as const) {
      const s = await cancelSubscription({ id: "S1", now: LATER }, await started(status));
      expect(s.status).toBe("cancelled");
      expect(s.cancelledAt).toBe(LATER);
    }
    await expect(cancelSubscription({ id: "S1", now: LATER }, await started("cancelled"))).rejects.toThrow(InvalidSubscriptionTransitionError);
  });

  it("changePlan swaps the plan, keeps the period, moves a trial to active, refuses retired", async () => {
    const repo = await started("trialing", true);
    const pro = plan({ id: "P2", code: "business" });
    const s = await changePlan({ id: "S1", planId: "P2", now: LATER }, repo, plans(plan(), pro));
    expect(s.planId).toBe("P2");
    expect(s.status).toBe("active");
    expect(s.trialEndsAt).toBeNull();
    expect(s.currentPeriodEnd).toBe("2026-02-28T10:00:00.000Z");
    await expect(changePlan({ id: "S1", planId: "P3", now: LATER }, repo, plans(plan(), pro))).rejects.toThrow(PlanNotFoundError);
    await expect(changePlan({ id: "S1", planId: "P2", now: LATER }, repo, plans(plan(), { ...pro, status: "retired" }))).rejects.toThrow(PlanRetiredError);
  });

  it("changePlan on a cancelled subscription rejects, naming both states", async () => {
    const repo = await started("cancelled");
    await expect(changePlan({ id: "S1", planId: "P1", now: LATER }, repo, plans(plan())))
      .rejects.toThrow(/cancelled/);
    await expect(changePlan({ id: "S1", planId: "P1", now: LATER }, repo, plans(plan())))
      .rejects.toThrow(/active/);
  });

  it("reports a missing subscription", async () => {
    await expect(renewSubscription({ id: "nope", now: LATER }, subs())).rejects.toThrow(SubscriptionNotFoundError);
  });

  it("a bad clock on a cancelled subscription rejects as InvalidSubscriptionError, not a transition error", async () => {
    await expect(renewSubscription({ id: "S1", now: "not a date" }, await started("cancelled")))
      .rejects.toThrow(InvalidSubscriptionError);
  });
});

describe("a renewal keeps the day the subscription is billed on", () => {
  async function started(now: string, billingCycle: "monthly" | "yearly" = "monthly"): Promise<Subscription> {
    return startSubscription({ ...base, billingCycle, now }, subs(), plans(plan()));
  }

  function periodEndsAfterRenewingOnTime(first: Subscription, renewals: number): string[] {
    const ends = [first.currentPeriodEnd];
    let current = first;
    for (let i = 0; i < renewals; i += 1) {
      current = applyRenewal(current, current.currentPeriodStart);
      ends.push(current.currentPeriodEnd);
    }
    return ends.map((end) => end.slice(0, 10));
  }

  it("returns to the 31st after a short February", async () => {
    expect(periodEndsAfterRenewingOnTime(await started("2027-01-31T10:00:00.000Z"), 4)).toEqual([
      "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31", "2027-06-30",
    ]);
  });

  it("lands on the 29th of a leap February and still returns to the 31st", async () => {
    expect(periodEndsAfterRenewingOnTime(await started("2028-01-31T10:00:00.000Z"), 2)).toEqual(["2028-02-29", "2028-03-31", "2028-04-30"]);
  });

  it("keeps a 30th through February", async () => {
    expect(periodEndsAfterRenewingOnTime(await started("2027-01-30T10:00:00.000Z"), 2)).toEqual(["2027-02-28", "2027-03-30", "2027-04-30"]);
  });

  it("keeps a yearly 29 February, falling back to the 28th only in the years without one", async () => {
    expect(periodEndsAfterRenewingOnTime(await started("2028-02-29T10:00:00.000Z", "yearly"), 3)).toEqual([
      "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29",
    ]);
  });

  it("starts a new billing day when a lapsed subscription is paid late", async () => {
    const first = await started("2027-01-31T10:00:00.000Z");
    const paidLate = applyRenewal(first, "2027-03-10T09:00:00.000Z");

    expect(paidLate.currentPeriodStart).toBe("2027-03-10T09:00:00.000Z");
    expect(periodEndsAfterRenewingOnTime(paidLate, 1)).toEqual(["2027-04-10", "2027-05-10"]);
  });

  it("clears the review mark when a lapsed renewal writes a new billing day, and keeps it when an on-time renewal wrote none", async () => {
    const marked = { ...(await started("2027-01-31T10:00:00.000Z")), billingAnchorNeedsReview: true };

    const paidLate = applyRenewal(marked, "2027-03-10T09:00:00.000Z");
    const paidOnTime = applyRenewal(marked, "2027-02-10T09:00:00.000Z");

    expect(paidLate.billingAnchorDay).toBe(10);
    expect(paidLate.billingAnchorNeedsReview).toBe(false);
    expect(paidOnTime.billingAnchorNeedsReview).toBe(true);
  });

  it("carries the Cairo time of day of the period it renews, which is an hour earlier in UTC once summer time has begun", async () => {
    const renewed = applyRenewal(await started("2027-01-31T10:00:00.000Z"), "2027-02-01T00:00:00.000Z");
    expect(renewed.currentPeriodEnd).toBe("2027-03-31T10:00:00.000Z");
    expect(applyRenewal(renewed, "2027-03-01T00:00:00.000Z").currentPeriodEnd).toBe("2027-04-30T09:00:00.000Z");
  });
});

describe("the billing day is the business day in Cairo, not the UTC day", () => {
  const ONE_AM_IN_CAIRO_ON_THE_15TH = "2026-01-14T23:00:00.000Z";

  it("anchors a signup made at 01:00 Cairo time on its own day, and ends the period on that Cairo day", async () => {
    const s = await startSubscription({ ...base, now: ONE_AM_IN_CAIRO_ON_THE_15TH }, subs(), plans(plan()));

    expect(s.billingAnchorDay).toBe(15);
    expect(s.currentPeriodEnd).toBe("2026-02-14T23:00:00.000Z");
    expect(billingAnchorDayOf({ currentPeriodStart: ONE_AM_IN_CAIRO_ON_THE_15TH })).toBe(15);
  });

  it("keeps the Cairo day and the Cairo time of day across the change to summer time", () => {
    expect(addPeriod("2026-04-14T22:30:00.000Z", "monthly")).toBe("2026-05-14T21:30:00.000Z");
    expect(addPeriod("2026-10-14T21:30:00.000Z", "monthly")).toBe("2026-11-14T22:30:00.000Z");
  });

  it("keeps a month-end anchor taken just after midnight in Cairo through February and back to the 31st", async () => {
    const repo = subs();
    const started = await startSubscription({ ...base, now: "2026-01-30T22:30:00.000Z" }, repo, plans(plan()));
    expect(started.billingAnchorDay).toBe(31);
    expect(started.currentPeriodEnd).toBe("2026-02-27T22:30:00.000Z");

    const renewed = await renewSubscription({ id: "S1", now: "2026-02-20T10:00:00.000Z" }, repo);

    expect(renewed.currentPeriodEnd).toBe("2026-03-30T22:30:00.000Z");
    expect(renewed.billingAnchorDay).toBe(31);
  });

  it("re-anchors a lapsed renewal on the Cairo day it was paid", async () => {
    const repo = subs();
    await startSubscription(base, repo, plans(plan()));

    const renewed = await renewSubscription({ id: "S1", now: "2026-03-09T23:30:00.000Z" }, repo);

    expect(renewed.billingAnchorDay).toBe(10);
    expect(renewed.currentPeriodEnd).toBe("2026-04-09T23:30:00.000Z");
  });
});

describe("a period end an earlier build computed in UTC, which is already the 1st of the next month in Cairo", () => {
  const legacy = (over: Partial<Subscription>): Subscription => ({
    id: "S-LEGACY", tenantId: "T1", planId: "PLAN-CORE", previousPlanId: null, status: "active", billingCycle: "monthly", trialEndsAt: null,
    addOnModules: [], extraSeats: 0, extraBranches: 0, extraWarehouses: 0, graceDays: 0, cancelledAt: null,
    createdAt: "2026-01-30T22:30:00.000Z", updatedAt: "2026-01-30T22:30:00.000Z",
    currentPeriodStart: "2026-01-30T22:30:00.000Z", currentPeriodEnd: "2026-02-28T22:30:00.000Z", ...over,
  });
  const PAID_ON_20_FEB = "2026-02-20T10:00:00.000Z";

  it.each([
    ["no stored anchor", undefined, "2026-03-30T22:30:00.000Z"],
    ["the UTC day as its anchor", 30, "2026-03-29T22:30:00.000Z"],
    ["the Cairo day as its anchor", 31, "2026-03-30T22:30:00.000Z"],
  ])("buys one month for one payment, ending in March, with %s", (_, billingAnchorDay, end) => {
    const renewed = applyRenewal(legacy(billingAnchorDay === undefined ? {} : { billingAnchorDay }), PAID_ON_20_FEB);

    expect(renewed.currentPeriodStart).toBe("2026-02-27T22:30:00.000Z");
    expect(renewed.currentPeriodEnd).toBe(end);
  });

  it("is read as the last day of its own month", () => {
    expect(settledPeriodEnd(legacy({}))).toBe("2026-02-27T22:30:00.000Z");
    expect(settledPeriodEnd(legacy({ createdAt: "2026-03-30T22:30:00.000Z", currentPeriodStart: "2026-03-30T22:30:00.000Z", currentPeriodEnd: "2026-04-30T22:30:00.000Z" }))).toBe(
      "2026-04-29T21:30:00.000Z",
    );
    expect(
      settledPeriodEnd(legacy({ billingCycle: "yearly", createdAt: "2024-02-28T22:30:00.000Z", currentPeriodStart: "2024-02-28T22:30:00.000Z", currentPeriodEnd: "2025-02-28T22:30:00.000Z" })),
    ).toBe("2025-02-27T22:30:00.000Z");
  });

  it("leaves alone a period end that is where the Cairo calendar puts it", () => {
    const midMonth = legacy({ createdAt: "2026-01-14T23:00:00.000Z", currentPeriodStart: "2026-01-14T23:00:00.000Z", currentPeriodEnd: "2026-02-14T23:00:00.000Z" });
    const firstOfMonth = legacy({ createdAt: "2026-01-31T22:30:00.000Z", currentPeriodStart: "2026-03-31T22:30:00.000Z", currentPeriodEnd: "2026-04-30T22:30:00.000Z", billingAnchorDay: 1 });
    const anchorMovedMidPeriod = legacy({ currentPeriodStart: "2026-01-31T10:00:00.000Z", currentPeriodEnd: "2026-02-28T10:00:00.000Z", billingAnchorDay: 27 });

    for (const row of [midMonth, firstOfMonth, anchorMovedMidPeriod]) expect(settledPeriodEnd(row)).toBe(row.currentPeriodEnd);
    expect(applyRenewal(midMonth, "2026-02-10T10:00:00.000Z").currentPeriodEnd).toBe("2026-03-14T23:00:00.000Z");
  });

  it("still starts a lapsed renewal at the moment it was paid", () => {
    const renewed = applyRenewal(legacy({}), "2026-03-05T10:00:00.000Z");

    expect(renewed.currentPeriodStart).toBe("2026-03-05T10:00:00.000Z");
    expect(renewed.currentPeriodEnd).toBe("2026-04-05T10:00:00.000Z");
  });
});

describe("inferBillingAnchorDay — the anchor a subscription stored before anchors existed must have had", () => {
  const legacy = (over: Partial<Subscription>): Subscription => ({
    id: "S1", tenantId: "T1", planId: "P1", status: "active", billingCycle: "monthly", addOnModules: [],
    extraSeats: 0, extraBranches: 0, extraWarehouses: 0,
    currentPeriodStart: NOW, currentPeriodEnd: "2026-02-28T10:00:00.000Z", trialEndsAt: null, previousPlanId: null,
    graceDays: 7, cancelledAt: null, createdAt: NOW, updatedAt: NOW, ...over,
  });

  it("is the Cairo day it was created on when it has never been renewed", () => {
    expect(inferBillingAnchorDay(legacy({}), [])).toBe(31);
    expect(inferBillingAnchorDay(legacy({ createdAt: "2026-01-14T23:00:00.000Z", currentPeriodStart: "2026-01-14T23:00:00.000Z", currentPeriodEnd: "2026-02-14T23:00:00.000Z" }), [])).toBe(15);
  });

  it("is still the day it was created on after renewals paid on time, even though the stored period has drifted down to the 28th", () => {
    const drifted = legacy({ currentPeriodStart: "2026-03-28T10:00:00.000Z", currentPeriodEnd: "2026-04-28T10:00:00.000Z" });

    expect(inferBillingAnchorDay(drifted, ["2026-02-20T09:00:00.000Z", "2026-03-20T09:00:00.000Z"])).toBe(31);
  });

  it("is not guessed when a renewal was recorded after its period had ended", () => {
    const lapsed = legacy({ currentPeriodStart: "2026-03-10T09:00:00.000Z", currentPeriodEnd: "2026-04-10T09:00:00.000Z" });

    expect(inferBillingAnchorDay(lapsed, ["2026-03-10T09:00:00.000Z"])).toBeNull();
  });

  it("is not guessed when the stored period is not the one its payments lead to", () => {
    const afterTrialDrop = legacy({ currentPeriodStart: "2026-02-14T10:00:00.000Z", currentPeriodEnd: "2026-03-14T10:00:00.000Z" });
    const morePeriodsThanPayments = legacy({ currentPeriodStart: "2026-04-28T10:00:00.000Z", currentPeriodEnd: "2026-05-28T10:00:00.000Z" });

    expect(inferBillingAnchorDay(afterTrialDrop, [])).toBeNull();
    expect(inferBillingAnchorDay(morePeriodsThanPayments, ["2026-02-20T09:00:00.000Z"])).toBeNull();
  });

  it("is not guessed when the stored day is later than the day it was created on", () => {
    const later = legacy({ createdAt: "2026-01-05T10:00:00.000Z", currentPeriodStart: "2026-01-19T10:00:00.000Z", currentPeriodEnd: "2026-02-19T10:00:00.000Z" });

    expect(inferBillingAnchorDay(later, [])).toBeNull();
  });
});

describe("setBillingAnchorDay", () => {
  it("sets the day the next renewals land on, clears the review mark and leaves the running period alone", async () => {
    const repo = subs();
    const started = await startSubscription(base, repo, plans(plan()));
    await repo.save({ ...started, billingAnchorDay: undefined, billingAnchorNeedsReview: true, currentPeriodStart: "2026-03-28T10:00:00.000Z", currentPeriodEnd: "2026-04-28T10:00:00.000Z" });

    const set = await setBillingAnchorDay({ id: "S1", day: 31, now: "2026-04-01T00:00:00.000Z" }, repo);

    expect(set).toMatchObject({ billingAnchorDay: 31, billingAnchorNeedsReview: false, currentPeriodEnd: "2026-04-28T10:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z" });
    expect((await renewSubscription({ id: "S1", now: "2026-04-20T00:00:00.000Z" }, repo)).currentPeriodEnd).toBe("2026-05-31T10:00:00.000Z");
  });

  it("refuses a day that is not on a calendar, and a cancelled subscription", async () => {
    const repo = subs();
    await startSubscription(base, repo, plans(plan()));
    for (const day of [0, 32, 1.5, Number.NaN]) {
      await expect(setBillingAnchorDay({ id: "S1", day, now: NOW }, repo)).rejects.toThrow(InvalidSubscriptionError);
    }
    await cancelSubscription({ id: "S1", now: NOW }, repo);
    await expect(setBillingAnchorDay({ id: "S1", day: 15, now: NOW }, repo)).rejects.toThrow(InvalidSubscriptionTransitionError);
  });
});


describe("a period end an earlier build computed in UTC for a subscription that started on the 1st in Cairo", () => {
  const legacy = (over: Partial<Subscription>): Subscription => ({
    id: "S-SHORT", tenantId: "T1", planId: "PLAN-CORE", previousPlanId: null, status: "active", billingCycle: "monthly", trialEndsAt: null,
    addOnModules: [], extraSeats: 0, extraBranches: 0, extraWarehouses: 0, graceDays: 0, cancelledAt: null,
    createdAt: "2024-02-29T22:30:00.000Z", updatedAt: "2024-02-29T22:30:00.000Z",
    currentPeriodStart: "2024-02-29T22:30:00.000Z", currentPeriodEnd: "2024-03-29T22:30:00.000Z", ...over,
  });
  const PAID_ON_28_MAR = "2024-03-28T10:00:00.000Z";

  it.each([
    ["no stored anchor", undefined],
    ["the 1st as its anchor", 1],
  ])("is read as the 1st of the next month, so one payment buys April and not two days, with %s", (_, billingAnchorDay) => {
    const row = legacy(billingAnchorDay === undefined ? {} : { billingAnchorDay });

    const renewed = applyRenewal(row, PAID_ON_28_MAR);

    expect(settledPeriodEnd(row)).toBe("2024-03-31T22:30:00.000Z");
    expect(renewed.currentPeriodStart).toBe("2024-03-31T22:30:00.000Z");
    expect(renewed.currentPeriodEnd).toBe("2024-04-30T21:30:00.000Z");
  });

  it("is left where it is when the stored anchor is another day: the renewal already ends on that day a month later", () => {
    const row = legacy({ billingAnchorDay: 29 });

    const renewed = applyRenewal(row, PAID_ON_28_MAR);

    expect(settledPeriodEnd(row)).toBe("2024-03-29T22:30:00.000Z");
    expect(renewed.currentPeriodStart).toBe("2024-03-29T22:30:00.000Z");
    expect(renewed.currentPeriodEnd).toBe("2024-04-28T21:30:00.000Z");
  });

  it("is settled once: the settled end is not moved again", () => {
    const settled = settledPeriodEnd(legacy({}));

    expect(settledPeriodEnd(legacy({ currentPeriodEnd: settled }))).toBe(settled);
  });

  it("is told apart from a short period the current build wrote after the owner moved the billing day", () => {
    const anchorMovedBack = legacy({ currentPeriodStart: "2024-03-29T22:30:00.000Z", currentPeriodEnd: "2024-03-31T22:30:00.000Z", billingAnchorDay: 30 });

    expect(settledPeriodEnd(anchorMovedBack)).toBe("2024-03-31T22:30:00.000Z");
  });
});

describe("every period an earlier build could have written in UTC, for every hour a subscription could start in a leap year", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const CYCLES = ["monthly", "yearly"] as const;
  const cairo = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const inCairo = (iso: string): string => cairo.format(new Date(iso));
  const cairoDayOf = (iso: string): number => Number(inCairo(iso).slice(8, 10));

  function endTheEarlierBuildWrote(startIso: string, cycle: (typeof CYCLES)[number]): string {
    const d = new Date(startIso);
    const year = d.getUTCFullYear() + (cycle === "yearly" ? 1 : 0);
    const month = d.getUTCMonth() + (cycle === "monthly" ? 1 : 0);
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes())).toISOString();
  }

  const row = (start: string, cycle: (typeof CYCLES)[number], end: string, billingAnchorDay: number | undefined): Subscription => ({
    id: "S-SWEEP", tenantId: "T1", planId: "PLAN-CORE", previousPlanId: null, status: "active", billingCycle: cycle, trialEndsAt: null,
    addOnModules: [], extraSeats: 0, extraBranches: 0, extraWarehouses: 0, graceDays: 0, cancelledAt: null,
    createdAt: start, updatedAt: start, currentPeriodStart: start, currentPeriodEnd: end, ...(billingAnchorDay === undefined ? {} : { billingAnchorDay }),
  });

  function withTheAnchorTheStoreSettles(s: Subscription): Subscription {
    if (!anchorIsUtcDayOfCreation(s)) return s;
    const day = inferBillingAnchorDay(s, []);
    return day === null ? { ...s, billingAnchorNeedsReview: true } : { ...s, billingAnchorDay: day };
  }

  const oneCycle = (cycle: (typeof CYCLES)[number], fromIso: string, toIso: string): boolean => {
    const days = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS);
    return cycle === "monthly" ? days >= 28 && days <= 31 : days >= 364 && days <= 366;
  };

  function* everyHourOf2024(): Generator<string> {
    for (let at = Date.UTC(2024, 0, 1, 0, 30); at < Date.UTC(2025, 0, 1); at += HOUR_MS) yield new Date(at).toISOString();
  }

  it("is one cycle long once settled, and the renewal paid for it is one cycle long too (a year can be a day short across a summer-time change)", () => {
    const offenders: string[] = [];
    let rows = 0;
    for (const start of everyHourOf2024()) {
      for (const cycle of CYCLES) {
        for (const anchor of new Set([undefined, cairoDayOf(start), new Date(start).getUTCDate()])) {
          rows += 1;
          const stored = withTheAnchorTheStoreSettles(row(start, cycle, endTheEarlierBuildWrote(start, cycle), anchor));
          const settled = settledPeriodEnd(stored);
          const renewed = applyRenewal(stored, new Date(new Date(settled).getTime() - 2 * DAY_MS).toISOString());
          const sound =
            renewed.currentPeriodStart === settled &&
            settledPeriodEnd({ ...stored, currentPeriodEnd: settled }) === settled &&
            oneCycle(cycle, start, settled) &&
            oneCycle(cycle, renewed.currentPeriodStart, renewed.currentPeriodEnd);
          if (!sound) offenders.push(`${inCairo(start)} ${cycle} anchor ${String(anchor)}: ${inCairo(stored.currentPeriodEnd)} read as ${inCairo(settled)}, renewed to ${inCairo(renewed.currentPeriodEnd)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
    expect(rows).toBeGreaterThan(35_000);
  });

  it("never moves a period end the current build wrote, under its own anchor, an anchor the owner set, or after the owner moved the anchor or the cycle", () => {
    const moved: string[] = [];
    let rows = 0;
    const check = (start: string, writtenUnder: number | undefined, read: Subscription): void => {
      rows += 1;
      if (settledPeriodEnd(read) === read.currentPeriodEnd) return;
      moved.push(`${inCairo(start)} ${read.billingCycle} written under ${String(writtenUnder)}, read under ${String(read.billingAnchorDay)}: ${inCairo(read.currentPeriodEnd)} read as ${inCairo(settledPeriodEnd(read))}`);
    };
    for (const start of everyHourOf2024()) {
      for (const cycle of CYCLES) {
        for (const anchor of new Set([undefined, new Date(start).getUTCDate(), 1, 31])) {
          const written = row(start, cycle, addPeriod(start, cycle, anchor), anchor);
          check(start, anchor, written);
          check(start, anchor, row(start, cycle, written.currentPeriodEnd, cairoDayOf(start)));
          if (anchor === undefined) check(start, anchor, { ...written, billingCycle: cycle === "monthly" ? "yearly" : "monthly" });
        }
      }
    }

    expect(moved).toEqual([]);
    expect(rows).toBeGreaterThan(120_000);
  });
});
