import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { Money, OwnerConfirmation, PlanKind, type Plan, type Subscription, type Tenant, type PlatformUser, type Payment } from "@mezan/domain";
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

  it.each([
    ["with no expiry, as an earlier build stored it", { userId: "U2", email: "next@cyag.eg", requestedBy: "tenant:cyag:U9", requestedAt: NOW, tokenHash: null }],
    ["with its fields in another order", { tokenHash: "abc", expiresAt: "2026-09-20T10:00:00.000Z", requestedAt: NOW, requestedBy: "tenant:cyag:U9", email: "next@cyag.eg", userId: "U2" }],
  ])("moves the owner of a tenant whose pending hand-over was stored %s", async (_label, storedPending) => {
    const db = new Database(":memory:");
    const earlier = createSqlitePlatformStores(db);
    await earlier.tenants.save(tenant);
    db.prepare("UPDATE tenant SET pending_owner = ? WHERE id = 'T1'").run(JSON.stringify(storedPending));

    const stores = createSqlitePlatformStores(db);
    const before = (await stores.tenants.findById("T1"))!;
    const declined = await stores.tenants.compareAndSetOwner(before, { ...before, pendingOwner: null }, async () => undefined);

    expect(before.pendingOwner).toMatchObject({ userId: "U2", expiresAt: "2026-09-20T10:00:00.000Z" });
    expect(declined).toBe(true);
    expect((await stores.tenants.findById("T1"))?.pendingOwner).toBeUndefined();
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

  it("writes an owner change only while the tenant's own record that is still due is the one the writer read", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    const first = { eventId: "E1", userId: "U1", previousUserId: null, actor: "platform:P", confirmedBy: OwnerConfirmation.PlatformConsole };
    const second = { ...first, eventId: "E2", userId: "U2", previousUserId: "U1" };
    const due: Tenant = { ...tenant, ownerUserId: "U1", ownerRecordDue: first };
    await stores.tenants.save(due);
    const effects: string[] = [];

    const overAnUnseenRecord = await stores.tenants.compareAndSetOwner({ ...due, ownerRecordDue: null }, { ...due, ownerUserId: "U2", ownerRecordDue: second }, async () => void effects.push("over an unseen record"));
    const overAnotherRecord = await stores.tenants.compareAndSetOwner({ ...due, ownerRecordDue: second }, { ...due, ownerRecordDue: null }, async () => void effects.push("over another record"));

    expect(overAnUnseenRecord).toBe(false);
    expect(overAnotherRecord).toBe(false);
    expect(await stores.tenants.findById("T1")).toEqual(due);

    expect(await stores.tenants.compareAndSetOwner(due, { ...due, ownerRecordDue: null }, async () => void effects.push("cleared"))).toBe(true);
    expect((await stores.tenants.findById("T1"))?.ownerRecordDue).toBeUndefined();
    expect(effects).toEqual(["cleared"]);
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

  describe("the one-time anchor-day backfill", () => {
    const legacy = (over: Partial<Subscription>): Subscription => ({
      ...sub, createdAt: "2026-01-31T10:00:00.000Z", currentPeriodStart: "2026-01-31T10:00:00.000Z", currentPeriodEnd: "2026-02-28T10:00:00.000Z", ...over,
    });

    async function storedBeforeAnchorsExisted(db: InstanceType<typeof Database>) {
      const before = createSqlitePlatformStores(db);
      await before.subscriptions.save(legacy({ id: "S-ON-TIME", tenantId: "T-ON-TIME", currentPeriodStart: "2026-03-28T10:00:00.000Z", currentPeriodEnd: "2026-04-28T10:00:00.000Z" }));
      await before.payments.save({ ...payment, id: "P1", tenantId: "T-ON-TIME", subscriptionId: "S-ON-TIME", createdAt: "2026-02-20T09:00:00.000Z" });
      await before.payments.save({ ...payment, id: "P2", tenantId: "T-ON-TIME", subscriptionId: "S-ON-TIME", createdAt: "2026-03-20T09:00:00.000Z" });
      await before.subscriptions.save(legacy({ id: "S-LATE", tenantId: "T-LATE", currentPeriodStart: "2026-03-10T09:00:00.000Z", currentPeriodEnd: "2026-04-10T09:00:00.000Z" }));
      await before.payments.save({ ...payment, id: "P3", tenantId: "T-LATE", subscriptionId: "S-LATE", createdAt: "2026-03-10T09:00:00.000Z" });
      await before.subscriptions.save(legacy({ id: "S-NIGHT", tenantId: "T-NIGHT", createdAt: "2026-01-14T23:00:00.000Z", currentPeriodStart: "2026-01-14T23:00:00.000Z", currentPeriodEnd: "2026-02-14T23:00:00.000Z" }));
      await before.subscriptions.save(legacy({ id: "S-GONE", tenantId: "T-GONE", status: "cancelled", cancelledAt: NOW }));
      await before.subscriptions.save(legacy({ id: "S-SET", tenantId: "T-SET", billingAnchorDay: 12 }));
      db.exec("DELETE FROM platform_migration");
    }

    it("restores the day a subscription was created on when its renewals were all on time, marks the ones its history does not settle, and leaves set and cancelled ones alone", async () => {
      const db = new Database(":memory:");
      await storedBeforeAnchorsExisted(db);

      const { subscriptions } = createSqlitePlatformStores(db);

      expect(await subscriptions.findById("S-ON-TIME")).toMatchObject({ billingAnchorDay: 31, currentPeriodEnd: "2026-04-28T10:00:00.000Z" });
      expect((await subscriptions.findById("S-ON-TIME"))?.billingAnchorNeedsReview).toBeUndefined();
      expect((await subscriptions.findById("S-NIGHT"))?.billingAnchorDay).toBe(15);
      const late = await subscriptions.findById("S-LATE");
      expect(late?.billingAnchorDay).toBeUndefined();
      expect(late?.billingAnchorNeedsReview).toBe(true);
      expect(await subscriptions.findById("S-GONE")).not.toHaveProperty("billingAnchorDay");
      expect(await subscriptions.findById("S-GONE")).not.toHaveProperty("billingAnchorNeedsReview");
      expect((await subscriptions.findById("S-SET"))?.billingAnchorDay).toBe(12);
      db.close();
    });

    it("runs once: what the platform owner set afterwards is not looked at again", async () => {
      const db = new Database(":memory:");
      await storedBeforeAnchorsExisted(db);
      const first = createSqlitePlatformStores(db);
      const late = await first.subscriptions.findById("S-LATE");
      if (!late) throw new Error("the late subscription is missing");
      await first.subscriptions.save({ ...late, billingAnchorDay: 10, billingAnchorNeedsReview: false });
      db.exec("UPDATE subscription SET billing_anchor_day = NULL WHERE id = 'S-ON-TIME'");

      const again = createSqlitePlatformStores(db);

      expect(await again.subscriptions.findById("S-LATE")).toMatchObject({ billingAnchorDay: 10 });
      expect((await again.subscriptions.findById("S-LATE"))?.billingAnchorNeedsReview).toBeUndefined();
      expect((await again.subscriptions.findById("S-ON-TIME"))?.billingAnchorDay).toBeUndefined();
      db.close();
    });
  });

  describe("period ends an earlier build computed in UTC", () => {
    async function storedBefore(db: InstanceType<typeof Database>) {
      const before = createSqlitePlatformStores(db);
      await before.subscriptions.save({
        ...sub, id: "S-SPILLED", tenantId: "T-SPILLED", createdAt: "2026-01-30T22:30:00.000Z",
        currentPeriodStart: "2026-01-30T22:30:00.000Z", currentPeriodEnd: "2026-02-28T22:30:00.000Z",
      });
      await before.subscriptions.save({
        ...sub, id: "S-MIDMONTH", tenantId: "T-MIDMONTH", createdAt: "2026-01-14T23:00:00.000Z",
        currentPeriodStart: "2026-01-14T23:00:00.000Z", currentPeriodEnd: "2026-02-14T23:00:00.000Z",
      });
      await before.subscriptions.save({
        ...sub, id: "S-ENDED", tenantId: "T-ENDED", status: "cancelled", cancelledAt: NOW, createdAt: "2026-01-30T22:30:00.000Z",
        currentPeriodStart: "2026-01-30T22:30:00.000Z", currentPeriodEnd: "2026-02-28T22:30:00.000Z",
      });
      db.exec("DELETE FROM platform_migration WHERE name LIKE '%period-end%'");
    }

    it("moves a month-end period end that spilled into the 1st in Cairo back to the last day of its month, once", async () => {
      const db = new Database(":memory:");
      await storedBefore(db);

      const first = createSqlitePlatformStores(db);
      const repaired = await first.subscriptions.findById("S-SPILLED");
      await first.subscriptions.save({ ...repaired!, currentPeriodEnd: "2026-02-28T22:30:00.000Z" });
      const second = createSqlitePlatformStores(db);

      expect(repaired?.currentPeriodEnd).toBe("2026-02-27T22:30:00.000Z");
      expect((await second.subscriptions.findById("S-SPILLED"))?.currentPeriodEnd).toBe("2026-02-28T22:30:00.000Z");
      db.close();
    });

    it("touches neither a mid-month period nor a cancelled subscription", async () => {
      const db = new Database(":memory:");
      await storedBefore(db);

      const { subscriptions } = createSqlitePlatformStores(db);

      expect((await subscriptions.findById("S-MIDMONTH"))?.currentPeriodEnd).toBe("2026-02-14T23:00:00.000Z");
      expect((await subscriptions.findById("S-ENDED"))?.currentPeriodEnd).toBe("2026-02-28T22:30:00.000Z");
      db.close();
    });
  });

  describe("period ends an earlier build computed in UTC for a subscription that started on the 1st in Cairo", () => {
    const SHORT = { createdAt: "2024-02-29T22:30:00.000Z", currentPeriodStart: "2024-02-29T22:30:00.000Z", currentPeriodEnd: "2024-03-29T22:30:00.000Z" };

    async function storedBeforeTheSecondRepair(db: InstanceType<typeof Database>) {
      const before = createSqlitePlatformStores(db);
      await before.subscriptions.save({ ...sub, id: "S-SHORT", tenantId: "T-SHORT", ...SHORT });
      await before.subscriptions.save({ ...sub, id: "S-SHORT-ON-1", tenantId: "T-SHORT-ON-1", ...SHORT, billingAnchorDay: 1 });
      await before.subscriptions.save({ ...sub, id: "S-SHORT-ON-29", tenantId: "T-SHORT-ON-29", ...SHORT, billingAnchorDay: 29 });
      await before.subscriptions.save({ ...sub, id: "S-SHORT-ENDED", tenantId: "T-SHORT-ENDED", status: "cancelled", cancelledAt: NOW, ...SHORT });
      await before.subscriptions.save({
        ...sub, id: "S-CURRENT", tenantId: "T-CURRENT", createdAt: "2024-02-29T22:30:00.000Z",
        currentPeriodStart: "2024-02-29T22:30:00.000Z", currentPeriodEnd: "2024-03-31T22:30:00.000Z", billingAnchorDay: 1,
      });
      db.exec("DELETE FROM platform_migration WHERE name = '2026-10-period-end-utc-short-repair'");
    }

    it("are moved to the next 1st on a store the first period-end repair already ran on, once", async () => {
      const db = new Database(":memory:");
      await storedBeforeTheSecondRepair(db);
      const markersBefore = (db.prepare("SELECT name FROM platform_migration ORDER BY name").all() as { name: string }[]).map((row) => row.name);

      const first = createSqlitePlatformStores(db);
      const repaired = await first.subscriptions.findById("S-SHORT");
      const repairedOnTheFirst = await first.subscriptions.findById("S-SHORT-ON-1");
      await first.subscriptions.save({ ...repaired!, currentPeriodEnd: SHORT.currentPeriodEnd });
      const second = createSqlitePlatformStores(db);

      expect(markersBefore).toContain("2026-10-period-end-cairo-repair");
      expect(markersBefore).not.toContain("2026-10-period-end-utc-short-repair");
      expect(repaired?.currentPeriodEnd).toBe("2024-03-31T22:30:00.000Z");
      expect(repairedOnTheFirst?.currentPeriodEnd).toBe("2024-03-31T22:30:00.000Z");
      expect((await second.subscriptions.findById("S-SHORT"))?.currentPeriodEnd).toBe(SHORT.currentPeriodEnd);
      db.close();
    });

    it("touch neither a period anchored on another day, nor a cancelled subscription, nor a period the current build wrote", async () => {
      const db = new Database(":memory:");
      await storedBeforeTheSecondRepair(db);

      const { subscriptions } = createSqlitePlatformStores(db);

      expect((await subscriptions.findById("S-SHORT-ON-29"))?.currentPeriodEnd).toBe(SHORT.currentPeriodEnd);
      expect((await subscriptions.findById("S-SHORT-ENDED"))?.currentPeriodEnd).toBe(SHORT.currentPeriodEnd);
      expect((await subscriptions.findById("S-CURRENT"))?.currentPeriodEnd).toBe("2024-03-31T22:30:00.000Z");
      db.close();
    });
  });

  describe("period ends an earlier build computed in UTC across a change of summer time", () => {
    const SUMMER = { billingCycle: "yearly" as const, createdAt: "2024-04-25T21:30:00.000Z", currentPeriodStart: "2024-04-25T21:30:00.000Z", currentPeriodEnd: "2025-04-25T21:30:00.000Z", billingAnchorDay: 25 };

    async function storedBeforeTheThirdRepair(db: InstanceType<typeof Database>) {
      const before = createSqlitePlatformStores(db);
      await before.subscriptions.save({ ...sub, id: "S-SUMMER", tenantId: "T-SUMMER", ...SUMMER });
      await before.subscriptions.save({ ...sub, id: "S-SUMMER-ENDED", tenantId: "T-SUMMER-ENDED", status: "cancelled", cancelledAt: NOW, ...SUMMER });
      await before.subscriptions.save({ ...sub, id: "S-SUMMER-NOON", tenantId: "T-SUMMER-NOON", ...SUMMER, createdAt: "2024-04-25T10:00:00.000Z", currentPeriodStart: "2024-04-25T10:00:00.000Z", currentPeriodEnd: "2025-04-25T10:00:00.000Z" });
      db.exec("DELETE FROM platform_migration WHERE name = '2026-10-period-end-summer-time-repair'");
    }

    it("are moved back onto the billing day on a store both earlier period-end repairs already ran on, once", async () => {
      const db = new Database(":memory:");
      await storedBeforeTheThirdRepair(db);
      const markersBefore = (db.prepare("SELECT name FROM platform_migration ORDER BY name").all() as { name: string }[]).map((row) => row.name);

      const first = createSqlitePlatformStores(db);
      const repaired = await first.subscriptions.findById("S-SUMMER");
      await first.subscriptions.save({ ...repaired!, currentPeriodEnd: SUMMER.currentPeriodEnd });
      const second = createSqlitePlatformStores(db);

      expect(markersBefore).toEqual(expect.arrayContaining(["2026-10-period-end-cairo-repair", "2026-10-period-end-utc-short-repair"]));
      expect(markersBefore).not.toContain("2026-10-period-end-summer-time-repair");
      expect(repaired?.currentPeriodEnd).toBe("2025-04-25T20:30:00.000Z");
      expect((await second.subscriptions.findById("S-SUMMER"))?.currentPeriodEnd).toBe(SUMMER.currentPeriodEnd);
      db.close();
    });

    it("touch neither a period that ends on its billing day an hour off its time, nor a cancelled subscription", async () => {
      const db = new Database(":memory:");
      await storedBeforeTheThirdRepair(db);

      const { subscriptions } = createSqlitePlatformStores(db);

      expect((await subscriptions.findById("S-SUMMER-NOON"))?.currentPeriodEnd).toBe("2025-04-25T10:00:00.000Z");
      expect((await subscriptions.findById("S-SUMMER-ENDED"))?.currentPeriodEnd).toBe(SUMMER.currentPeriodEnd);
      db.close();
    });
  });

  describe("anchor days stored as the UTC day by an earlier build", () => {
    const stored = (over: Partial<Subscription>): Subscription => ({ ...sub, ...over });
    const NEVER_RENEWED = { createdAt: "2024-02-29T22:30:00.000Z", currentPeriodStart: "2024-02-29T22:30:00.000Z", currentPeriodEnd: "2024-03-29T22:30:00.000Z" };

    async function storedWithUtcAnchors(db: InstanceType<typeof Database>) {
      const before = createSqlitePlatformStores(db);
      await before.subscriptions.save(stored({
        id: "S-MIDNIGHT", tenantId: "T-MIDNIGHT", createdAt: "2026-01-31T22:30:00.000Z",
        currentPeriodStart: "2026-03-31T22:30:00.000Z", currentPeriodEnd: "2026-04-30T22:30:00.000Z", billingAnchorDay: 31,
      }));
      await before.payments.save({ ...payment, id: "P1", tenantId: "T-MIDNIGHT", subscriptionId: "S-MIDNIGHT", createdAt: "2026-02-20T10:00:00.000Z" });
      await before.payments.save({ ...payment, id: "P2", tenantId: "T-MIDNIGHT", subscriptionId: "S-MIDNIGHT", createdAt: "2026-03-20T10:00:00.000Z" });
      await before.subscriptions.save(stored({
        id: "S-LATE-NIGHT", tenantId: "T-LATE-NIGHT", createdAt: "2026-01-14T23:00:00.000Z",
        currentPeriodStart: "2026-03-14T23:00:00.000Z", currentPeriodEnd: "2026-04-14T23:00:00.000Z", billingAnchorDay: 14,
      }));
      await before.payments.save({ ...payment, id: "P3", tenantId: "T-LATE-NIGHT", subscriptionId: "S-LATE-NIGHT", createdAt: "2026-02-10T10:00:00.000Z" });
      await before.payments.save({ ...payment, id: "P4", tenantId: "T-LATE-NIGHT", subscriptionId: "S-LATE-NIGHT", createdAt: "2026-03-10T10:00:00.000Z" });
      await before.subscriptions.save(stored({
        id: "S-UNSETTLED", tenantId: "T-UNSETTLED", createdAt: "2026-01-14T23:00:00.000Z",
        currentPeriodStart: "2026-03-20T09:00:00.000Z", currentPeriodEnd: "2026-04-20T09:00:00.000Z", billingAnchorDay: 14,
      }));
      await before.payments.save({ ...payment, id: "P5", tenantId: "T-UNSETTLED", subscriptionId: "S-UNSETTLED", createdAt: "2026-03-20T09:00:00.000Z" });
      await before.subscriptions.save(stored({
        id: "S-DAYTIME", tenantId: "T-DAYTIME", createdAt: "2026-01-12T10:00:00.000Z",
        currentPeriodStart: "2026-01-12T10:00:00.000Z", currentPeriodEnd: "2026-02-12T10:00:00.000Z", billingAnchorDay: 12,
      }));
      await before.subscriptions.save(stored({
        id: "S-CHOSEN", tenantId: "T-CHOSEN", createdAt: "2026-01-14T23:00:00.000Z",
        currentPeriodStart: "2026-01-14T23:00:00.000Z", currentPeriodEnd: "2026-02-14T23:00:00.000Z", billingAnchorDay: 20,
      }));
      await before.subscriptions.save(stored({ id: "S-FIRST-PERIOD", tenantId: "T-FIRST-PERIOD", ...NEVER_RENEWED, billingAnchorDay: 29 }));
      db.exec("DELETE FROM platform_migration WHERE name LIKE '%utc%'");
    }

    it("moves the anchor of a subscription that was never renewed to the Cairo day it was created on, with no review mark, and its first period then ends on that day", async () => {
      const db = new Database(":memory:");
      await storedWithUtcAnchors(db);

      const { subscriptions } = createSqlitePlatformStores(db);

      expect(await subscriptions.findById("S-FIRST-PERIOD")).toMatchObject({ billingAnchorDay: 1, currentPeriodEnd: "2024-03-31T22:30:00.000Z" });
      expect((await subscriptions.findById("S-FIRST-PERIOD"))?.billingAnchorNeedsReview).toBeUndefined();
      db.close();
    });

    describe("on a store the first anchor repair and both period-end repairs already ran on", () => {
      const NEW_MARKERS = ["2026-10-billing-anchor-utc-unrenewed-repair", "2026-10-period-end-summer-time-repair"] as const;
      const markersIn = (db: InstanceType<typeof Database>): string[] => (db.prepare("SELECT name FROM platform_migration ORDER BY name").all() as { name: string }[]).map((row) => row.name);

      async function leftByTheFirstRepair(db: InstanceType<typeof Database>) {
        const before = createSqlitePlatformStores(db);
        await before.subscriptions.save(stored({ id: "S-LEFT", tenantId: "T-LEFT", ...NEVER_RENEWED, billingAnchorDay: 29, billingAnchorNeedsReview: true }));
        await before.subscriptions.save(stored({ id: "S-OWNER-CHOSE", tenantId: "T-OWNER-CHOSE", ...NEVER_RENEWED, billingAnchorDay: 29 }));
        await before.subscriptions.save(stored({
          id: "S-LEFT-RENEWED", tenantId: "T-LEFT-RENEWED", createdAt: "2026-01-14T23:00:00.000Z",
          currentPeriodStart: "2026-03-20T09:00:00.000Z", currentPeriodEnd: "2026-04-20T09:00:00.000Z", billingAnchorDay: 14, billingAnchorNeedsReview: true,
        }));
        await before.payments.save({ ...payment, id: "P-LATE", tenantId: "T-LEFT-RENEWED", subscriptionId: "S-LEFT-RENEWED", createdAt: "2026-03-20T09:00:00.000Z" });
        for (const marker of NEW_MARKERS) db.prepare("DELETE FROM platform_migration WHERE name = ?").run(marker);
      }

      it("moves the anchor it left marked for review on a subscription that was never renewed, clears the mark, and the period end follows", async () => {
        const db = new Database(":memory:");
        await leftByTheFirstRepair(db);
        const markersBefore = markersIn(db);

        const { subscriptions } = createSqlitePlatformStores(db);

        expect(markersBefore).toEqual(expect.arrayContaining(["2026-10-billing-anchor-utc-repair", "2026-10-period-end-cairo-repair", "2026-10-period-end-utc-short-repair"]));
        for (const marker of NEW_MARKERS) expect(markersBefore).not.toContain(marker);
        expect(await subscriptions.findById("S-LEFT")).toMatchObject({ billingAnchorDay: 1, currentPeriodEnd: "2024-03-31T22:30:00.000Z" });
        expect((await subscriptions.findById("S-LEFT"))?.billingAnchorNeedsReview).toBeUndefined();
        expect(markersIn(db)).toEqual(expect.arrayContaining([...NEW_MARKERS]));
        db.close();
      });

      it("leaves a day nobody marked for review, which the platform owner may have chosen, and keeps the mark where the payment history disagrees", async () => {
        const db = new Database(":memory:");
        await leftByTheFirstRepair(db);

        const { subscriptions } = createSqlitePlatformStores(db);

        expect(await subscriptions.findById("S-OWNER-CHOSE")).toMatchObject({ billingAnchorDay: 29, currentPeriodEnd: NEVER_RENEWED.currentPeriodEnd });
        expect(await subscriptions.findById("S-LEFT-RENEWED")).toMatchObject({ billingAnchorDay: 14, billingAnchorNeedsReview: true });
        db.close();
      });

      it("runs once: a day and a mark put back afterwards are not moved again", async () => {
        const db = new Database(":memory:");
        await leftByTheFirstRepair(db);
        const first = createSqlitePlatformStores(db);
        const repaired = await first.subscriptions.findById("S-LEFT");
        if (!repaired) throw new Error("the subscription is missing");
        await first.subscriptions.save({ ...repaired, ...NEVER_RENEWED, billingAnchorDay: 29, billingAnchorNeedsReview: true });

        const again = createSqlitePlatformStores(db);

        expect(await again.subscriptions.findById("S-LEFT")).toMatchObject({ billingAnchorDay: 29, billingAnchorNeedsReview: true, currentPeriodEnd: NEVER_RENEWED.currentPeriodEnd });
        db.close();
      });
    });

    it("moves an anchor that was the UTC day of a subscription created after midnight in Cairo to the Cairo day its history proves", async () => {
      const db = new Database(":memory:");
      await storedWithUtcAnchors(db);

      const { subscriptions } = createSqlitePlatformStores(db);

      expect(await subscriptions.findById("S-MIDNIGHT")).toMatchObject({ billingAnchorDay: 1, currentPeriodEnd: "2026-04-30T22:30:00.000Z" });
      expect((await subscriptions.findById("S-MIDNIGHT"))?.billingAnchorNeedsReview).toBeUndefined();
      expect((await subscriptions.findById("S-LATE-NIGHT"))?.billingAnchorDay).toBe(15);
      db.close();
    });

    it("marks for review, and leaves the stored day, where the history does not settle the Cairo day", async () => {
      const db = new Database(":memory:");
      await storedWithUtcAnchors(db);

      const { subscriptions } = createSqlitePlatformStores(db);

      expect(await subscriptions.findById("S-UNSETTLED")).toMatchObject({ billingAnchorDay: 14, billingAnchorNeedsReview: true });
      db.close();
    });

    it("touches no anchor that is already the Cairo day, nor one somebody chose", async () => {
      const db = new Database(":memory:");
      await storedWithUtcAnchors(db);

      const { subscriptions } = createSqlitePlatformStores(db);

      expect(await subscriptions.findById("S-DAYTIME")).toMatchObject({ billingAnchorDay: 12 });
      expect((await subscriptions.findById("S-DAYTIME"))?.billingAnchorNeedsReview).toBeUndefined();
      expect(await subscriptions.findById("S-CHOSEN")).toMatchObject({ billingAnchorDay: 20 });
      expect((await subscriptions.findById("S-CHOSEN"))?.billingAnchorNeedsReview).toBeUndefined();
      db.close();
    });

    it("runs once: a day the platform owner sets afterwards is not moved back", async () => {
      const db = new Database(":memory:");
      await storedWithUtcAnchors(db);
      const first = createSqlitePlatformStores(db);
      const repaired = await first.subscriptions.findById("S-MIDNIGHT");
      if (!repaired) throw new Error("the subscription is missing");
      await first.subscriptions.save({ ...repaired, billingAnchorDay: 31 });

      const again = createSqlitePlatformStores(db);

      expect((await again.subscriptions.findById("S-MIDNIGHT"))?.billingAnchorDay).toBe(31);
      db.close();
    });
  });

  it("stores a review mark a renewal cleared, through the conditional write a renewal uses", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    const marked: Subscription = { ...sub, id: "S-MARKED", tenantId: "T-MARKED", billingAnchorNeedsReview: true };
    await stores.subscriptions.save(marked);
    const cleared: Subscription = { ...marked, billingAnchorDay: 9, billingAnchorNeedsReview: false, updatedAt: "2026-09-20T10:00:00.000Z" };

    expect(await stores.subscriptions.compareAndSet(marked, cleared, async () => undefined)).toBe(true);

    expect(await stores.subscriptions.findById("S-MARKED")).toMatchObject({ billingAnchorDay: 9 });
    expect((await stores.subscriptions.findById("S-MARKED"))?.billingAnchorNeedsReview).toBeUndefined();
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
    await expect(stores.tenants.save({ ...tenant, id: "T2", dbFile: "tenants/T2.db" })).rejects.toThrow(/UNIQUE/);
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
