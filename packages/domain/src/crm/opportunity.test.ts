import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InvalidOpportunityError } from "./errors.js";
import { createOpportunity, type CreateOpportunityCommand } from "./opportunity.js";
import { createInMemoryOpportunityRepository } from "./test-helpers/in-memory-crm-repositories.js";

function command(overrides: Partial<CreateOpportunityCommand> = {}): CreateOpportunityCommand {
  return {
    id: "opp-1",
    title: "توريد رفوف لفرع المعادي",
    customerId: "cust-1",
    stageId: "stage-1",
    ...overrides,
  };
}

describe("createOpportunity", () => {
  it("persists the opportunity and returns the same record the repository holds", async () => {
    const repo = createInMemoryOpportunityRepository();
    const created = await createOpportunity(command(), repo);
    expect(await repo.findById("opp-1")).toEqual(created);
  });

  it("starts every new opportunity open, with nothing closed yet", async () => {
    const repo = createInMemoryOpportunityRepository();
    const created = await createOpportunity(command(), repo);
    expect(created.status).toBe("open");
    expect(created.closedAt).toBeNull();
    expect(Date.parse(created.createdAt)).not.toBeNaN();
  });

  it("defaults the probability to 50, the value to zero and every optional field to null", async () => {
    const repo = createInMemoryOpportunityRepository();
    const created = await createOpportunity(command(), repo);
    expect(created.probability).toBe(50);
    expect(created.expectedValue.toString()).toBe("0.000000");
    expect(created.branchId).toBeNull();
    expect(created.expectedCloseDate).toBeNull();
    expect(created.notes).toBeNull();
  });

  it("carries the supplied branch, value, probability, close date and notes through", async () => {
    const repo = createInMemoryOpportunityRepository();
    const created = await createOpportunity(
      command({
        branchId: "BR2",
        expectedValue: Money.fromMajor("125000.75"),
        probability: 80,
        expectedCloseDate: "2026-10-01",
        notes: "بانتظار موافقة الإدارة",
      }),
      repo,
    );
    expect(created).toMatchObject({
      branchId: "BR2",
      probability: 80,
      expectedCloseDate: "2026-10-01",
      notes: "بانتظار موافقة الإدارة",
    });
    expect(created.expectedValue.toString()).toBe("125000.750000");
  });

  it("keeps an explicitly null branch null — unassigned is not 'every branch'", async () => {
    const repo = createInMemoryOpportunityRepository();
    const created = await createOpportunity(command({ branchId: null }), repo);
    expect(created.branchId).toBeNull();
  });

  it("accepts both ends of the probability range", async () => {
    const repo = createInMemoryOpportunityRepository();
    expect((await createOpportunity(command({ probability: 0 }), repo)).probability).toBe(0);
    expect((await createOpportunity(command({ id: "opp-2", probability: 100 }), repo)).probability).toBe(100);
  });

  it("refuses a title that is empty or only whitespace, and stores nothing", async () => {
    const repo = createInMemoryOpportunityRepository();
    await expect(createOpportunity(command({ title: "   " }), repo)).rejects.toThrow(InvalidOpportunityError);
    expect(await repo.findById("opp-1")).toBeNull();
  });

  it("refuses a probability outside 0–100", async () => {
    const repo = createInMemoryOpportunityRepository();
    await expect(createOpportunity(command({ probability: -1 }), repo)).rejects.toThrow(InvalidOpportunityError);
    await expect(createOpportunity(command({ probability: 101 }), repo)).rejects.toThrow(InvalidOpportunityError);
  });

  it("reports every reason at once, in Arabic", async () => {
    const repo = createInMemoryOpportunityRepository();
    try {
      await createOpportunity(command({ title: "", probability: 500 }), repo);
      throw new Error("expected InvalidOpportunityError");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidOpportunityError);
      expect((err as InvalidOpportunityError).reasons).toEqual([
        "العنوان مطلوب",
        "الاحتمالية يجب أن تكون بين 0 و100",
      ]);
    }
  });
});
