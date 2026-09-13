import { describe, it, expect } from "vitest";
import { Money, type Plan, type Subscription, type Tenant, type PlatformUser } from "@mezan/domain";
import { createSqlitePlatformStores } from "./platform-store.js";

const NOW = "2026-09-13T10:00:00.000Z";

const tenant: Tenant = {
  id: "T1", code: "cyag", nameAr: "سياج", nameEn: null, ownerEmail: "o@cyag.eg", status: "provisioning",
  dbFile: "tenants/cyag.db", createdAt: NOW, updatedAt: NOW,
};
const plan: Plan = {
  id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: ["accounting", "sales"],
  features: { "reports.export": true }, seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
  priceMonthly: Money.fromMajor("490.50"), priceYearly: Money.fromMajor("4900"), trialDays: 14,
  isPublic: true, sortOrder: 1, status: "active", createdAt: NOW,
};
const sub: Subscription = {
  id: "S1", tenantId: "T1", planId: "P1", status: "active", billingCycle: "monthly", addOnModules: ["hr"],
  extraSeats: 2, extraBranches: 0, extraWarehouses: 0, currentPeriodStart: NOW,
  currentPeriodEnd: "2026-10-13T10:00:00.000Z", trialEndsAt: null, graceDays: 7, cancelledAt: null,
  createdAt: NOW, updatedAt: NOW,
};
const user: PlatformUser = { id: "U1", email: "root@mezan.app", passwordHash: "h", role: "owner", status: "active", createdAt: NOW };

describe("createSqlitePlatformStores", () => {
  it("round-trips every model, Money included, and finds by code and email", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant);
    await stores.plans.save(plan);
    await stores.subscriptions.save(sub);
    await stores.platformUsers.save(user);

    expect(await stores.tenants.findById("T1")).toEqual(tenant);
    expect(await stores.tenants.findByCode("cyag")).toEqual(tenant);
    expect(await stores.tenants.list()).toEqual([tenant]);

    const p = await stores.plans.findByCode("core");
    expect(p).toEqual(plan);
    expect(p?.priceMonthly.equals(Money.fromMajor("490.50"))).toBe(true);
    expect(await stores.plans.list()).toEqual([plan]);

    expect(await stores.subscriptions.findById("S1")).toEqual(sub);
    expect(await stores.subscriptions.findLiveByTenant("T1")).toEqual(sub);
    expect(await stores.subscriptions.listByTenant("T1")).toEqual([sub]);
    expect(await stores.subscriptions.hasLiveByPlan("P1")).toBe(true);
    expect(await stores.subscriptions.hasLiveByPlan("P9")).toBe(false);

    expect(await stores.platformUsers.findByEmail("root@mezan.app")).toEqual(user);
    stores.close();
  });

  it("upserts by id and treats cancelled subscriptions as not live", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant);
    await stores.tenants.save({ ...tenant, status: "active" });
    expect((await stores.tenants.list()).map((t) => t.status)).toEqual(["active"]);

    await stores.subscriptions.save({ ...sub, status: "cancelled", cancelledAt: NOW });
    expect(await stores.subscriptions.findLiveByTenant("T1")).toBeNull();
    expect(await stores.subscriptions.hasLiveByPlan("P1")).toBe(false);
    expect(await stores.subscriptions.listByTenant("T1")).toHaveLength(1);
    stores.close();
  });

  it("refuses a second live subscription for one tenant at the database", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.subscriptions.save(sub);
    await expect(stores.subscriptions.save({ ...sub, id: "S2" })).rejects.toThrow(/UNIQUE/);
    await stores.subscriptions.save({ ...sub, id: "S2", status: "cancelled", cancelledAt: NOW });
    expect(await stores.subscriptions.listByTenant("T1")).toHaveLength(2);
    stores.close();
  });

  it("refuses duplicate tenant codes, plan codes and platform emails", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant);
    await expect(stores.tenants.save({ ...tenant, id: "T2" })).rejects.toThrow(/UNIQUE/);
    await stores.plans.save(plan);
    await expect(stores.plans.save({ ...plan, id: "P2" })).rejects.toThrow(/UNIQUE/);
    await stores.platformUsers.save(user);
    await expect(stores.platformUsers.save({ ...user, id: "U2" })).rejects.toThrow(/UNIQUE/);
    stores.close();
  });
});
