import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { createPlan, updatePlan, retirePlan, type Plan, type PlanRepository, type UpdatePlanCommand } from "./plan.js";
import { InvalidPlanError, PlanCodeTakenError, PlanInUseError, PlanNotFoundError } from "./errors.js";

function memoryRepo(): PlanRepository & { rows: Map<string, Plan> } {
  const rows = new Map<string, Plan>();
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(code) { return [...rows.values()].find((p) => p.code === code) ?? null; },
    async list() { return [...rows.values()]; },
    async save(p) { rows.set(p.id, p); },
  };
}

const NOW = "2026-09-13T10:00:00.000Z";
const cmd = {
  id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core",
  modules: ["accounting", "sales", "sales"], features: { "reports.export": true },
  seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
  priceMonthly: Money.fromMajor("490"), priceYearly: Money.fromMajor("4900"),
  trialDays: 14, isPublic: true, sortOrder: 1, now: NOW,
};
const noSubscribers = async () => false;

describe("createPlan", () => {
  it("creates an active plan with deduplicated modules", async () => {
    const repo = memoryRepo();
    const plan = await createPlan(cmd, repo);
    expect(plan.status).toBe("active");
    expect(plan.modules).toEqual(["accounting", "sales"]);
    expect(plan.priceMonthly.equals(Money.fromMajor("490"))).toBe(true);
    expect(plan.createdAt).toBe(NOW);
    expect(repo.rows.get("P1")).toBe(plan);
  });

  it("refuses an unknown module, an empty bundle, zero seats, a negative price and a bad code", async () => {
    await expect(createPlan({ ...cmd, modules: ["pos"] }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, modules: [] }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, seatsIncluded: 0 }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, priceMonthly: Money.fromMajor("-1") }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, code: "Core!" }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, trialDays: -1 }, memoryRepo())).rejects.toThrow(InvalidPlanError);
  });

  it("refuses a duplicate code", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    await expect(createPlan({ ...cmd, id: "P2" }, repo)).rejects.toThrow(PlanCodeTakenError);
  });
});

describe("updatePlan", () => {
  it("changes names, prices, capacity and adds a module, keeping code and createdAt", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    const next = await updatePlan(
      { id: "P1", code: "hacked", createdAt: "x", nameEn: "Core+", priceMonthly: Money.fromMajor("590"), seatsIncluded: 5, modules: ["accounting", "sales", "inventory"] } as UpdatePlanCommand,
      repo, noSubscribers,
    );
    expect(next.code).toBe("core");
    expect(next.createdAt).toBe(NOW);
    expect(next.nameEn).toBe("Core+");
    expect(next.nameAr).toBe("الأساسية");
    expect(next.seatsIncluded).toBe(5);
    expect(next.modules).toEqual(["accounting", "sales", "inventory"]);
    expect(next.priceMonthly.equals(Money.fromMajor("590"))).toBe(true);
  });

  it("leaves a field unchanged when the patch sends it as undefined", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    const next = await updatePlan({ id: "P1", isPublic: undefined, priceMonthly: undefined }, repo, noSubscribers);
    expect(next.isPublic).toBe(true);
    expect(next.priceMonthly.equals(Money.fromMajor("490"))).toBe(true);
  });

  it("removes a module only while nobody live subscribes", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    await expect(updatePlan({ id: "P1", modules: ["accounting"] }, repo, async () => true))
      .rejects.toThrow(PlanInUseError);
    const next = await updatePlan({ id: "P1", modules: ["accounting"] }, repo, noSubscribers);
    expect(next.modules).toEqual(["accounting"]);
  });

  it("adds a module even while somebody live subscribes", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    const next = await updatePlan({ id: "P1", modules: ["accounting", "sales", "inventory"] }, repo, async () => true);
    expect(next.modules).toEqual(["accounting", "sales", "inventory"]);
  });

  it("still validates on update and reports a missing plan", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    await expect(updatePlan({ id: "P1", seatsIncluded: 0 }, repo, noSubscribers)).rejects.toThrow(InvalidPlanError);
    await expect(updatePlan({ id: "nope" }, repo, noSubscribers)).rejects.toThrow(PlanNotFoundError);
  });
});

describe("retirePlan", () => {
  it("marks the plan retired and is idempotent", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    expect((await retirePlan({ id: "P1" }, repo)).status).toBe("retired");
    expect((await retirePlan({ id: "P1" }, repo)).status).toBe("retired");
  });
});
