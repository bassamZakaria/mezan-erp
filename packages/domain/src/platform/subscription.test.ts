import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { PlanKind, type Plan, type PlanRepository } from "./plan.js";
import {
  addPeriod, startSubscription, renewSubscription, changePlan, markPastDue,
  suspendSubscription, resumeSubscription, cancelSubscription,
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
    expect(s.currentPeriodEnd).toBe("2026-03-28T10:00:00.000Z");
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
