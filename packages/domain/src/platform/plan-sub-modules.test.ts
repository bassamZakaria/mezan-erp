import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { createPlan, normaliseModules, type Plan, type PlanRepository } from "./plan.js";
import { InvalidPlanError } from "./errors.js";
import { startModuleTrial, type ModuleTrial } from "./module-trial.js";

function memoryRepo(): PlanRepository {
  const rows = new Map<string, Plan>();
  return {
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(code) { return [...rows.values()].find((p) => p.code === code) ?? null; },
    async list() { return [...rows.values()]; },
    async save(p) { rows.set(p.id, p); },
  };
}

const cmd = {
  id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: ["sales"], features: {},
  seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
  priceMonthly: Money.fromMajor("490"), priceYearly: Money.fromMajor("4900"),
  trialDays: 14, isPublic: true, sortOrder: 1, now: "2026-10-31T10:00:00.000Z",
};

describe("plans carry sub-modules", () => {
  it("drops a part its parent already covers, and duplicates", () => {
    expect(normaliseModules(["hr", "hr.time", "sales", "sales"])).toEqual(["hr", "sales"]);
  });

  it("drops a free part, which every plan holds anyway", () => {
    expect(normaliseModules(["hr.people", "hr.time"])).toEqual(["hr.time"]);
  });

  it("keeps parts on a plan without their parent", async () => {
    const plan = await createPlan({ ...cmd, modules: ["sales", "hr.time", "hr.payroll"] }, memoryRepo());
    expect(plan.modules).toEqual(["sales", "hr.time", "hr.payroll"]);
  });

  it("refuses an unknown part", async () => {
    await expect(createPlan({ ...cmd, modules: ["sales", "hr.nope"] }, memoryRepo())).rejects.toThrow(InvalidPlanError);
  });
});

describe("module trials stay whole-module", () => {
  it("refuses a trial of a single part", async () => {
    const repo = { async listByTenant(): Promise<ModuleTrial[]> { return []; }, async insertIfFirst() { return true; } };
    await expect(
      startModuleTrial({ id: "T1", tenantId: "TEN", module: "hr.payroll", startedBy: "U", entitledModules: ["sales"], now: cmd.now }, repo as never),
    ).rejects.toThrow("التجربة متاحة للوحدة كاملة فقط");
  });
});
