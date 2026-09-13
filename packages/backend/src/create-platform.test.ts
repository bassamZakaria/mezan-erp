import { describe, it, expect } from "vitest";
import { MODULE_CATALOG, Money, type Plan } from "@mezan/domain";
import { createSqlitePlatformStores, openSqliteConnection } from "@mezan/persistence";
import { createPlatform, PLATFORM_SEED_PLANS } from "./create-platform.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00Z");

describe("createPlatform", () => {
  it("seeds core, business and enterprise once, in order, at zero price", async () => {
    const platform = await createPlatform({ dbPath: ":memory:", now: FIXED_NOW });
    const plans = await platform.stores.plans.list();
    expect(plans.map((p) => p.code)).toEqual(["core", "business", "enterprise"]);
    expect(plans.map((p) => p.seatsIncluded)).toEqual([3, 10, 25]);
    for (const p of plans) {
      expect(p.trialDays).toBe(14);
      expect(p.priceMonthly.equals(Money.zero())).toBe(true);
      expect(p.status).toBe("active");
      expect(p.isPublic).toBe(true);
      expect(p.createdAt).toBe("2026-01-01T00:00:00.000Z");
    }
    const enterprise = plans[2]!;
    expect([...enterprise.modules].sort()).toEqual([...MODULE_CATALOG].sort());
    const business = plans[1]!;
    expect(business.modules).not.toContain("hr");
    expect(business.modules).not.toContain("manufacturing");
    expect(business.modules).toContain("crm");
    expect(business.modules).toHaveLength(17);
    const core = plans[0]!;
    expect(core.modules).toEqual(PLATFORM_SEED_PLANS[0]!.modules);
    expect(core.modules).toHaveLength(11);
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
});
