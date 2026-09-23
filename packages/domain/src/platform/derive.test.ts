import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { PlanKind, type Plan } from "./plan.js";
import type { Subscription } from "./subscription.js";
import type { Tenant } from "./tenant.js";
import { deriveEntitlements, subscriptionLicenseState } from "./derive.js";

const plan: Plan = {
  id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core", kind: PlanKind.Paid, quotas: {}, modules: ["accounting", "sales"],
  features: { "reports.export": true }, seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
  priceMonthly: Money.fromMajor("490"), priceYearly: Money.fromMajor("4900"), trialDays: 14,
  isPublic: true, sortOrder: 1, status: "active", createdAt: "2026-01-01T00:00:00.000Z",
};

const sub: Subscription = {
  id: "S1", tenantId: "T1", planId: "P1", status: "active", billingCycle: "monthly",
  addOnModules: ["hr", "sales"], extraSeats: 2, extraBranches: 0, extraWarehouses: 0,
  currentPeriodStart: "2026-09-01T00:00:00.000Z", currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  trialEndsAt: null, graceDays: 7, cancelledAt: null,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

const tenant: Tenant = {
  id: "T1", code: "cyag", nameAr: "سياج", nameEn: "Cyag", ownerEmail: "o@cyag.eg", status: "active",
  dbFile: "tenants/cyag.db", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("deriveEntitlements", () => {
  it("unions modules, sums seats, passes features, expires at period end", () => {
    expect(deriveEntitlements(plan, sub)).toEqual({
      plan: "core", activeModules: ["accounting", "sales", "hr"], features: { "reports.export": true },
      seats: 5, expiresAt: "2026-10-01T00:00:00.000Z", limits: { branches: 1, warehouses: 1 },
    });
  });

  it("expires at the trial end while trialing", () => {
    const trial = { ...sub, status: "trialing" as const, trialEndsAt: "2026-09-15T00:00:00.000Z" };
    expect(deriveEntitlements(plan, trial).expiresAt).toBe("2026-09-15T00:00:00.000Z");
  });

  it("sums plan-included and subscription extra branches and warehouses into limits", () => {
    const extras = { ...sub, extraBranches: 2, extraWarehouses: 3 };
    expect(deriveEntitlements(plan, extras).limits).toEqual({ branches: 3, warehouses: 4 });
  });
});

describe("subscriptionLicenseState", () => {
  const at = (now: string, s: Subscription | null = sub, t: Tenant = tenant) => subscriptionLicenseState(t, s, now);

  it("archived tenant is INVALID and unusable", () => {
    expect(at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "archived" })).toMatchObject({ state: "INVALID", canWrite: false, usable: false });
  });

  it("provisioning tenant or no subscription is UNLICENSED, readable", () => {
    expect(at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "provisioning" })).toMatchObject({ state: "UNLICENSED", canWrite: false, usable: true });
    expect(at("2026-09-13T00:00:00.000Z", null)).toMatchObject({ state: "UNLICENSED", canWrite: false, usable: true });
  });

  it("suspended tenant, suspended or cancelled subscription are READ_ONLY", () => {
    expect(at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "suspended" })).toMatchObject({ state: "READ_ONLY", canWrite: false, usable: true });
    expect(at("2026-09-13T00:00:00.000Z", { ...sub, status: "cancelled" })).toEqual({
      state: "READ_ONLY", canWrite: false, usable: true, licensee: "سياج",
      expiresAt: "2026-10-01T00:00:00.000Z", reason: "SUBSCRIPTION_CANCELLED",
    });
    expect(at("2026-09-13T00:00:00.000Z", { ...sub, status: "suspended" })).toEqual({
      state: "READ_ONLY", canWrite: false, usable: true, licensee: "سياج",
      expiresAt: "2026-10-01T00:00:00.000Z", reason: "SUBSCRIPTION_SUSPENDED",
    });
  });

  it("trial: ACTIVE before its end, READ_ONLY after, no grace", () => {
    const trial = { ...sub, status: "trialing" as const, trialEndsAt: "2026-09-15T00:00:00.000Z" };
    expect(at("2026-09-14T23:59:59.000Z", trial)).toMatchObject({ state: "ACTIVE", canWrite: true, expiresAt: "2026-09-15T00:00:00.000Z" });
    expect(at("2026-09-15T00:00:00.000Z", trial)).toMatchObject({ state: "READ_ONLY", canWrite: false });
  });

  it("active or past_due: ACTIVE in period, GRACE for graceDays after, then READ_ONLY", () => {
    expect(at("2026-09-30T23:59:59.000Z")).toMatchObject({ state: "ACTIVE", canWrite: true, licensee: "سياج" });
    expect(at("2026-10-01T00:00:00.000Z")).toEqual({
      state: "GRACE", canWrite: true, usable: true, licensee: "سياج",
      expiresAt: "2026-10-01T00:00:00.000Z", graceEndsAt: "2026-10-08T00:00:00.000Z",
    });
    expect(at("2026-10-07T23:59:59.000Z", { ...sub, status: "past_due" })).toEqual({
      state: "GRACE", canWrite: true, usable: true, licensee: "سياج",
      expiresAt: "2026-10-01T00:00:00.000Z", graceEndsAt: "2026-10-08T00:00:00.000Z",
    });
    expect(at("2026-10-08T00:00:00.000Z")).toMatchObject({ state: "READ_ONLY", canWrite: false, usable: true });
  });

  it("a clock without milliseconds on the GRACE boundary still normalises to GRACE", () => {
    expect(at("2026-10-01T00:00:00Z")).toMatchObject({ state: "GRACE", canWrite: true, graceEndsAt: "2026-10-08T00:00:00.000Z" });
  });

  it("an unparseable clock is INVALID with reason INVALID_CLOCK, before any state rule", () => {
    expect(at("garbage")).toEqual({ state: "INVALID", canWrite: false, usable: true, licensee: "سياج", reason: "INVALID_CLOCK" });
  });

  it("the post-grace READ_ONLY result carries no graceEndsAt", () => {
    const r = at("2026-10-08T00:00:00.000Z");
    expect(r).not.toHaveProperty("graceEndsAt");
  });

  it("every non-writable result carries its exact reason code", () => {
    expect(at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "archived" }).reason).toBe("TENANT_ARCHIVED");
    expect(at("2026-09-13T00:00:00.000Z", null).reason).toBe("NO_SUBSCRIPTION");
    expect(at("2026-09-13T00:00:00.000Z", { ...sub, status: "cancelled" }).reason).toBe("SUBSCRIPTION_CANCELLED");
    expect(at("2026-09-13T00:00:00.000Z", { ...sub, status: "suspended" }).reason).toBe("SUBSCRIPTION_SUSPENDED");
    expect(at("2026-10-08T00:00:00.000Z").reason).toBe("GRACE_ENDED");
    expect(at("garbage").reason).toBe("INVALID_CLOCK");
    for (const r of [
      at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "archived" }),
      at("2026-09-13T00:00:00.000Z", null),
      at("2026-09-13T00:00:00.000Z", { ...sub, status: "cancelled" }),
      at("2026-10-08T00:00:00.000Z"),
      at("garbage"),
    ]) {
      expect(r.canWrite).toBe(false);
      expect(typeof r.reason).toBe("string");
    }
  });
});
