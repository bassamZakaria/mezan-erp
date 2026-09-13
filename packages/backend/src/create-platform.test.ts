import { describe, it, expect } from "vitest";
import { MODULE_CATALOG, Money } from "@mezan/domain";
import { createPlatform, PLATFORM_SEED_PLANS } from "./create-platform.js";

describe("createPlatform", () => {
  it("seeds core, business and enterprise once, in order, at zero price", async () => {
    const platform = await createPlatform({ dbPath: ":memory:" });
    const plans = await platform.stores.plans.list();
    expect(plans.map((p) => p.code)).toEqual(["core", "business", "enterprise"]);
    expect(plans.map((p) => p.seatsIncluded)).toEqual([3, 10, 25]);
    for (const p of plans) {
      expect(p.trialDays).toBe(14);
      expect(p.priceMonthly.equals(Money.zero())).toBe(true);
      expect(p.status).toBe("active");
      expect(p.isPublic).toBe(true);
    }
    const enterprise = plans[2]!;
    expect([...enterprise.modules].sort()).toEqual([...MODULE_CATALOG].sort());
    const business = plans[1]!;
    expect(business.modules).not.toContain("hr");
    expect(business.modules).toContain("crm");
    const core = plans[0]!;
    expect(core.modules).toEqual(PLATFORM_SEED_PLANS[0]!.modules);
    platform.close();
  });

  it("does not reseed when a plan already exists", async () => {
    const platform = await createPlatform({ dbPath: ":memory:" });
    const before = await platform.stores.plans.list();
    await platform.seedPlansIfEmpty();
    expect(await platform.stores.plans.list()).toEqual(before);
    platform.close();
  });
});
