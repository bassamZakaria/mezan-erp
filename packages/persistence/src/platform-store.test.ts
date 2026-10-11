import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { Money, PlanKind, type Plan, type Subscription, type Tenant, type PlatformUser, type Payment } from "@mezan/domain";
import { createSqlitePlatformStores } from "./platform-store.js";

const NOW = "2026-09-13T10:00:00.000Z";

const tenant: Tenant = {
  id: "T1", code: "cyag", nameAr: "سياج", nameEn: null, ownerEmail: "o@cyag.eg", status: "provisioning",
  ownerUserId: null, ownerContactVerified: true, dbFile: "tenants/cyag.db", createdAt: NOW, updatedAt: NOW,
};
const plan: Plan = {
  id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core", kind: PlanKind.Paid, quotas: {}, modules: ["accounting", "sales"],
  features: { "reports.export": true }, seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
  priceMonthly: Money.fromMajor("490.50"), priceYearly: Money.fromMajor("4900"), trialDays: 14,
  isPublic: true, sortOrder: 1, status: "active", createdAt: NOW,
};
const sub: Subscription = {
  id: "S1", tenantId: "T1", planId: "P1", status: "active", billingCycle: "monthly", addOnModules: ["hr"],
  extraSeats: 2, extraBranches: 0, extraWarehouses: 0, currentPeriodStart: NOW,
  currentPeriodEnd: "2026-10-13T10:00:00.000Z", trialEndsAt: null, previousPlanId: null, graceDays: 7, cancelledAt: null,
  createdAt: NOW, updatedAt: NOW,
};
const user: PlatformUser = { id: "U1", email: "root@mezan.app", passwordHash: "h", role: "owner", status: "active", createdAt: NOW };
const payment: Payment = {
  id: "PAY1", tenantId: "T1", subscriptionId: "S1", amount: Money.fromMajor("490.50"), currency: "EGP",
  reference: "TRX-001", paidAt: NOW, recordedBy: "U1", note: null, createdAt: NOW,
};

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
    expect(await stores.plans.findById("P1")).toEqual(plan);
    expect(await stores.plans.list()).toEqual([plan]);

    expect(await stores.subscriptions.findById("S1")).toEqual(sub);
    expect(await stores.subscriptions.findLiveByTenant("T1")).toEqual(sub);
    expect(await stores.subscriptions.listByTenant("T1")).toEqual([sub]);
    expect(await stores.subscriptions.hasLiveByPlan("P1")).toBe(true);
    expect(await stores.subscriptions.hasLiveByPlan("P9")).toBe(false);
    expect(await stores.subscriptions.listByPlan("P1")).toEqual([sub]);
    expect(await stores.subscriptions.listByPlan("P9")).toEqual([]);

    expect(await stores.platformUsers.findByEmail("root@mezan.app")).toEqual(user);
    expect(await stores.platformUsers.findById("U1")).toEqual(user);
    expect(await stores.platformUsers.list()).toEqual([user]);

    await stores.payments.save(payment);
    expect(await stores.payments.findById("PAY1")).toEqual(payment);
    const paymentList = await stores.payments.listByTenant("T1");
    expect(paymentList).toEqual([payment]);
    expect(paymentList[0]?.amount.equals(Money.fromMajor("490.50"))).toBe(true);
    stores.close();
  });

  it("exposes its sqlite connection and lists payments newest paidAt first", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    expect(stores.sqlite.open).toBe(true);
    await stores.payments.save({ ...payment, id: "PAY1", paidAt: "2026-09-01T00:00:00.000Z" });
    await stores.payments.save({ ...payment, id: "PAY2", paidAt: "2026-09-10T00:00:00.000Z" });
    await stores.payments.save({ ...payment, id: "PAY3", tenantId: "T2", paidAt: "2026-09-20T00:00:00.000Z" });
    const list = await stores.payments.listByTenant("T1");
    expect(list.map((x) => x.id)).toEqual(["PAY2", "PAY1"]);
    stores.close();
  });

  it("upserts by id and treats cancelled subscriptions as not live", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant);
    await stores.tenants.save({ ...tenant, status: "active" });
    expect((await stores.tenants.list()).map((t) => t.status)).toEqual(["active"]);

    await stores.subscriptions.save(sub);
    await stores.subscriptions.save({ ...sub, status: "cancelled", cancelledAt: NOW });
    expect(await stores.subscriptions.findLiveByTenant("T1")).toBeNull();
    expect(await stores.subscriptions.hasLiveByPlan("P1")).toBe(false);
    expect(await stores.subscriptions.listByTenant("T1")).toHaveLength(1);
    expect(await stores.subscriptions.listByPlan("P1")).toEqual([]);
    stores.close();
  });

  it("lists every live subscription across tenants on one plan, excluding cancelled ones", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.subscriptions.save(sub);
    await stores.subscriptions.save({ ...sub, id: "S2", tenantId: "T2" });
    await stores.subscriptions.save({ ...sub, id: "S3", tenantId: "T3", status: "cancelled", cancelledAt: NOW });
    await stores.subscriptions.save({ ...sub, id: "S4", tenantId: "T4", planId: "P2" });
    const rows = await stores.subscriptions.listByPlan("P1");
    expect(rows.map((s) => s.id).sort()).toEqual(["S1", "S2"]);
    stores.close();
  });

  it("reuses a caller-owned connection and leaves it open after close()", async () => {
    const db = new Database(":memory:");
    const stores = createSqlitePlatformStores(db);
    await stores.tenants.save(tenant);
    stores.close();
    expect(db.open).toBe(true);
    expect(await stores.tenants.findById("T1")).toEqual(tenant);
    db.close();
  });

  it("moves the owner only while the stored owner is the one the caller read, and undoes the move when its side effect fails", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant);
    const linked = { ...tenant, ownerUserId: "U1", updatedAt: "2026-09-14T00:00:00.000Z" };
    const effects: string[] = [];

    expect(await stores.tenants.compareAndSetOwner(tenant, linked, async () => { effects.push("linked"); })).toBe(true);
    expect(await stores.tenants.findById("T1")).toEqual(linked);

    const stale = { ...tenant, ownerEmail: "late@cyag.eg" };
    expect(await stores.tenants.compareAndSetOwner(tenant, stale, async () => { effects.push("stale"); })).toBe(false);
    expect(await stores.tenants.findById("T1")).toEqual(linked);
    expect(effects).toEqual(["linked"]);

    const moved = { ...linked, ownerEmail: "new@cyag.eg", ownerContactVerified: false };
    await expect(stores.tenants.compareAndSetOwner(linked, moved, async () => { throw new Error("audit refused"); })).rejects.toThrow("audit refused");
    expect(await stores.tenants.findById("T1")).toEqual(linked);
    stores.close();
  });

  it("adds the owner columns to a platform database created before them, with every contact verified", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE tenant (id TEXT PRIMARY KEY, code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT, owner_email TEXT NOT NULL,
      status TEXT NOT NULL, db_file TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO tenant VALUES ('T0', 'old', 'قديمة', NULL, 'owner@old.eg', 'active', 'tenants/old.db', ?, ?)`).run(NOW, NOW);
    const stores = createSqlitePlatformStores(db);
    expect(await stores.tenants.findById("T0")).toMatchObject({ ownerEmail: "owner@old.eg", ownerUserId: null, ownerContactVerified: true });
    db.close();
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

  it("refuses a duplicate payment id — payments are append-only", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.payments.save(payment);
    await expect(stores.payments.save({ ...payment, note: "second write" })).rejects.toThrow(/UNIQUE/);
    stores.close();
  });
});

describe("a subscription's billing day", () => {
  it("is kept with the subscription, and a row stored before it existed reads back without one", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.subscriptions.save({ ...sub, billingAnchorDay: 31 });
    await stores.subscriptions.save({ ...sub, id: "S-OLD", tenantId: "T-OLD" });

    expect((await stores.subscriptions.findById("S1"))?.billingAnchorDay).toBe(31);
    expect(await stores.subscriptions.findById("S-OLD")).toEqual({ ...sub, id: "S-OLD", tenantId: "T-OLD" });
    stores.close();
  });

  it("is added to a platform database created before the column existed", () => {
    const raw = new Database(":memory:");
    raw.exec(`CREATE TABLE subscription (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plan_id TEXT NOT NULL, status TEXT NOT NULL, billing_cycle TEXT NOT NULL,
      add_on_modules TEXT NOT NULL, extra_seats INTEGER NOT NULL, extra_branches INTEGER NOT NULL, extra_warehouses INTEGER NOT NULL,
      current_period_start TEXT NOT NULL, current_period_end TEXT NOT NULL, trial_ends_at TEXT, previous_plan_id TEXT,
      grace_days INTEGER NOT NULL, cancelled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);

    createSqlitePlatformStores(raw);

    expect((raw.prepare(`PRAGMA table_info(subscription)`).all() as { name: string }[]).map((column) => column.name)).toContain("billing_anchor_day");
    raw.close();
  });
});

describe("signup provisioning claim", () => {
  const TOKEN = "token-hash";
  const AT = "2026-01-15T10:00:00.000Z";
  const STALE_BEFORE = "2026-01-15T09:58:00.000Z";

  it("is held by one claimant at a time and passes on only once released", async () => {
    const { signupRequests, close } = createSqlitePlatformStores(":memory:");

    expect(await signupRequests.tryClaimProvisioning(TOKEN, "first", AT, STALE_BEFORE)).toBe(true);
    expect(await signupRequests.tryClaimProvisioning(TOKEN, "second", AT, STALE_BEFORE)).toBe(false);
    expect(await signupRequests.tryClaimProvisioning("another-token", "second", AT, STALE_BEFORE)).toBe(true);

    await signupRequests.releaseProvisioning(TOKEN, "second");
    expect(await signupRequests.tryClaimProvisioning(TOKEN, "second", AT, STALE_BEFORE)).toBe(false);

    await signupRequests.releaseProvisioning(TOKEN, "first");
    expect(await signupRequests.tryClaimProvisioning(TOKEN, "second", AT, STALE_BEFORE)).toBe(true);
    close();
  });

  it("gives each claim a generation higher than every claim before it, on any token, and none to a caller that does not hold the claim", async () => {
    const { signupRequests, close } = createSqlitePlatformStores(":memory:");

    await signupRequests.tryClaimProvisioning(TOKEN, "first", AT, STALE_BEFORE);
    const first = await signupRequests.provisioningFence(TOKEN, "first");
    expect(await signupRequests.provisioningFence(TOKEN, "second")).toBeNull();
    await signupRequests.tryClaimProvisioning("another-token", "other", AT, STALE_BEFORE);
    const other = await signupRequests.provisioningFence("another-token", "other");
    await signupRequests.releaseProvisioning(TOKEN, "first");
    await signupRequests.releaseProvisioning("another-token", "other");
    await signupRequests.tryClaimProvisioning(TOKEN, "second", AT, STALE_BEFORE);
    const second = await signupRequests.provisioningFence(TOKEN, "second");

    expect(first).toBeGreaterThan(0);
    expect(other).toBeGreaterThan(first ?? 0);
    expect(second).toBeGreaterThan(other ?? 0);
    expect(await signupRequests.provisioningFence(TOKEN, "first")).toBeNull();
    close();
  });

  it("is taken over once its holder has been gone longer than the stale window, and not a moment before", async () => {
    const { signupRequests, close } = createSqlitePlatformStores(":memory:");
    await signupRequests.tryClaimProvisioning(TOKEN, "dead", "2026-01-15T09:58:00.000Z", "2026-01-15T09:56:00.000Z");

    expect(await signupRequests.tryClaimProvisioning(TOKEN, "live", AT, STALE_BEFORE)).toBe(false);
    expect(await signupRequests.tryClaimProvisioning(TOKEN, "live", "2026-01-15T10:00:01.000Z", "2026-01-15T09:58:01.000Z")).toBe(true);

    await signupRequests.releaseProvisioning(TOKEN, "dead");
    expect(await signupRequests.tryClaimProvisioning(TOKEN, "other", "2026-01-15T10:00:02.000Z", "2026-01-15T09:58:02.000Z")).toBe(false);
    close();
  });

  it("stays with a holder that keeps renewing it, and tells a holder that lost it so", async () => {
    const { signupRequests, close } = createSqlitePlatformStores(":memory:");
    await signupRequests.tryClaimProvisioning(TOKEN, "slow", "2026-01-15T09:58:00.000Z", "2026-01-15T09:56:00.000Z");
    expect(await signupRequests.provisioningClaimedAt(TOKEN)).toBe("2026-01-15T09:58:00.000Z");

    expect(await signupRequests.renewProvisioning(TOKEN, "slow", "2026-01-15T10:00:00.000Z")).toBe(true);
    expect(await signupRequests.provisioningClaimedAt(TOKEN)).toBe("2026-01-15T10:00:00.000Z");
    expect(await signupRequests.tryClaimProvisioning(TOKEN, "eager", "2026-01-15T10:00:01.000Z", "2026-01-15T09:58:01.000Z")).toBe(false);

    expect(await signupRequests.tryClaimProvisioning(TOKEN, "eager", "2026-01-15T10:03:00.000Z", "2026-01-15T10:01:00.000Z")).toBe(true);
    expect(await signupRequests.renewProvisioning(TOKEN, "slow", "2026-01-15T10:03:01.000Z")).toBe(false);
    expect(await signupRequests.provisioningClaimedAt(TOKEN)).toBe("2026-01-15T10:03:00.000Z");

    await signupRequests.releaseProvisioning(TOKEN, "eager");
    expect(await signupRequests.provisioningClaimedAt(TOKEN)).toBeNull();
    close();
  });
});
