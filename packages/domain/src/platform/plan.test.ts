import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { createPlan, updatePlan, retirePlan, type Plan, type PlanRepository, type UpdatePlanCommand } from "./plan.js";
import { FreePlanRequiredError, InvalidPlanError, PlanCodeTakenError, PlanInUseError, PlanNotFoundError } from "./errors.js";
import { PlanKind } from "./plan.js";

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
    await expect(createPlan({ ...cmd, modules: ["telepathy"] }, memoryRepo())).rejects.toThrow(InvalidPlanError);
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

  it("refuses a clock that is not an ISO-8601 timestamp", async () => {
    await expect(createPlan({ ...cmd, now: "garbage" }, memoryRepo())).rejects.toThrow(InvalidPlanError);
  });

  it("normalises a clock with no milliseconds", async () => {
    const plan = await createPlan({ ...cmd, now: "2026-09-13T10:00:00Z" }, memoryRepo());
    expect(plan.createdAt).toBe("2026-09-13T10:00:00.000Z");
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

describe("the free plan every trial ends on", () => {
  const free = { ...cmd, id: "F1", code: "free", kind: PlanKind.Free, priceMonthly: Money.zero(), priceYearly: Money.zero(), trialDays: 0 };

  it("cannot be retired while it is the only one, and can once another free plan is active", async () => {
    const repo = memoryRepo();
    await createPlan(free, repo);

    await expect(retirePlan({ id: "F1" }, repo)).rejects.toThrow(FreePlanRequiredError);
    expect(repo.rows.get("F1")?.status).toBe("active");

    await createPlan({ ...free, id: "F2", code: "free-2" }, repo);
    expect((await retirePlan({ id: "F1" }, repo)).status).toBe("retired");
  });

  it("cannot be turned into a paid plan while it is the only one, by the edit that would leave none", async () => {
    const repo = memoryRepo();
    await createPlan(free, repo);
    const makePaid = { id: "F1", kind: PlanKind.Paid, priceMonthly: Money.fromMajor("100"), priceYearly: Money.fromMajor("1000") };

    const refused = await updatePlan(makePaid, repo, noSubscribers).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(FreePlanRequiredError);
    expect((refused as FreePlanRequiredError).message).toMatch(/لا يمكن تحويل الباقة المجانية الوحيدة/);
    expect(repo.rows.get("F1")?.kind).toBe(PlanKind.Free);

    expect((await updatePlan({ id: "F1", nameAr: "المجانية" }, repo, noSubscribers)).nameAr).toBe("المجانية");
    await createPlan({ ...free, id: "F2", code: "free-2" }, repo);
    expect((await updatePlan(makePaid, repo, noSubscribers)).kind).toBe(PlanKind.Paid);
  });
});
