import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { MODULE_CATALOG, Money, type Plan } from "@mezan/domain";
import { createSqlitePlatformStores, openSqliteConnection } from "@mezan/persistence";
import { createPlatform, PLATFORM_SEED_PLANS } from "./create-platform.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00Z");

describe("createPlatform", () => {
  it("seeds core, business and enterprise once, in order, at their EGP prices", async () => {
    const platform = await createPlatform({ dbPath: ":memory:", now: FIXED_NOW });
    const plans = await platform.stores.plans.list();
    expect(plans.map((p) => p.code)).toEqual(["core", "business", "enterprise"]);
    expect(plans.map((p) => p.seatsIncluded)).toEqual([3, 10, 25]);
    expect(plans.map((p) => p.priceMonthly.toString())).toEqual(["490.000000", "980.000000", "1960.000000"]);
    expect(plans.map((p) => p.priceYearly.toString())).toEqual(["4900.000000", "9800.000000", "19600.000000"]);
    for (const p of plans) {
      expect(p.trialDays).toBe(14);
      expect(p.status).toBe("active");
      expect(p.isPublic).toBe(true);
      expect(p.createdAt).toBe("2026-01-01T00:00:00.000Z");
    }
    const enterprise = plans[2]!;
    // `pos` is licensable (DEC-23) but deliberately stays out of the seeded
    // SaaS plans until the POS close-out lane — see `create-platform.ts`.
    expect([...enterprise.modules].sort()).toEqual([...MODULE_CATALOG].filter((id) => id !== "pos").sort());
    const business = plans[1]!;
    expect(business.modules).not.toContain("hr");
    expect(business.modules).not.toContain("manufacturing");
    expect(business.modules).toContain("crm");
    // 15, down from 17: DEC-14 deleted every `dashboard.*` and
    // `transactions.*` permission, so neither is a module a plan can sell.
    expect(business.modules).toHaveLength(15);
    const core = plans[0]!;
    expect(core.modules).toEqual(PLATFORM_SEED_PLANS[0]!.modules);
    expect(core.modules).toHaveLength(9);
    platform.close();
  });

  it("does not reseed when a plan already exists", async () => {
    const platform = await createPlatform({ dbPath: ":memory:" });
    const before = await platform.stores.plans.list();
    await platform.seedPlansIfEmpty();
    expect(await platform.stores.plans.list()).toEqual(before);
    platform.close();
  });

  it("fills in whichever seed plan is missing, leaving an existing one untouched", async () => {
    const { sqlite: db } = openSqliteConnection(":memory:");
    const preseeded: Plan = {
      id: "PLAN-CORE",
      code: "core",
      nameAr: PLATFORM_SEED_PLANS[0]!.nameAr,
      nameEn: PLATFORM_SEED_PLANS[0]!.nameEn,
      modules: PLATFORM_SEED_PLANS[0]!.modules,
      features: {},
      seatsIncluded: PLATFORM_SEED_PLANS[0]!.seatsIncluded,
      branchesIncluded: PLATFORM_SEED_PLANS[0]!.branchesIncluded,
      warehousesIncluded: PLATFORM_SEED_PLANS[0]!.warehousesIncluded,
      priceMonthly: Money.zero(),
      priceYearly: Money.zero(),
      trialDays: PLATFORM_SEED_PLANS[0]!.trialDays,
      isPublic: PLATFORM_SEED_PLANS[0]!.isPublic,
      sortOrder: PLATFORM_SEED_PLANS[0]!.sortOrder,
      status: "active",
      createdAt: "2020-01-01T00:00:00.000Z",
    };
    await createSqlitePlatformStores(db).plans.save(preseeded);

    const platform = await createPlatform({ dbPath: db, now: FIXED_NOW });
    const plans = await platform.stores.plans.list();
    expect(plans.map((p) => p.code).sort()).toEqual(["business", "core", "enterprise"]);
    const core = plans.find((p) => p.code === "core")!;
    expect(core.createdAt).toBe("2020-01-01T00:00:00.000Z");
    const business = plans.find((p) => p.code === "business")!;
    const enterprise = plans.find((p) => p.code === "enterprise")!;
    expect(business.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(enterprise.createdAt).toBe("2026-01-01T00:00:00.000Z");
    platform.close();
  });

  it("seeds one owner when the table is empty", async () => {
    const platform = await createPlatform({
      dbPath: ":memory:",
      now: FIXED_NOW,
      owner: { email: "root@mezan.app", password: "correct horse battery" },
    });
    expect(platform.ownerSeeded).toBe(true);
    const users = await platform.stores.platformUsers.list();
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("root@mezan.app");
    expect(users[0]?.role).toBe("owner");
    expect(users[0]?.status).toBe("active");
    platform.close();
  });

  it("never seeds a second owner", async () => {
    const { sqlite: db } = openSqliteConnection(":memory:");
    const first = await createPlatform({
      dbPath: db,
      now: FIXED_NOW,
      owner: { email: "root@mezan.app", password: "correct horse battery" },
    });
    first.close();
    const second = await createPlatform({
      dbPath: db,
      now: FIXED_NOW,
      owner: { email: "someone-else@mezan.app", password: "correct horse battery" },
    });
    expect(second.ownerSeeded).toBe(false);
    expect(await second.stores.platformUsers.list()).toHaveLength(1);
    second.close();
  });

  it("without an owner option, never seeds and reports ownerSeeded false", async () => {
    const platform = await createPlatform({ dbPath: ":memory:", now: FIXED_NOW });
    expect(platform.ownerSeeded).toBe(false);
    expect(await platform.stores.platformUsers.list()).toHaveLength(0);
    platform.close();
  });

  it("exposes an audit sink on the same connection", async () => {
    const platform = await createPlatform({ dbPath: ":memory:", now: FIXED_NOW });
    await platform.audit.append({
      stream: "security", module: "platform", entityType: "PLATFORM_USER", entityId: "U1",
      action: "PLATFORM_LOGIN_SUCCEEDED", actor: "U1", branchId: null,
      timestamp: "2026-01-01T00:00:00.000Z", severity: "INFO", details: null,
    });
    const rows = await platform.audit.query("security");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("PLATFORM_LOGIN_SUCCEEDED");
    platform.close();
  });

  it("exposes a hasher, defaulting to a real scrypt hasher", async () => {
    const platform = await createPlatform({ dbPath: ":memory:", now: FIXED_NOW });
    const hash = await platform.hasher.hash("some secret");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await platform.hasher.verify("some secret", hash)).toBe(true);
    platform.close();
  });

  describe("backupTo", () => {
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it("writes a verified, openable copy of the live platform database to the destination path", async () => {
      dir = mkdtempSync(path.join(tmpdir(), "mezan-platform-backup-test-"));
      const platform = await createPlatform({ dbPath: path.join(dir, "platform.db"), now: FIXED_NOW });

      const destination = path.join(dir, "backup.sqlite");
      await platform.backupTo(destination);

      expect(existsSync(destination)).toBe(true);
      const { sqlite: copy } = openSqliteConnection(destination);
      try {
        expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
        const plan = copy.prepare("SELECT code FROM plan WHERE code = ?").get("core") as { code: string } | undefined;
        expect(plan?.code).toBe("core");
      } finally {
        copy.close();
      }
      platform.close();
    });
  });
});
