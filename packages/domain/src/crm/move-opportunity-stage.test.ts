import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InvalidOpportunityError } from "./errors.js";
import { OpportunityLostReason } from "./lost-reason.js";
import { moveOpportunityStage } from "./move-opportunity-stage.js";
import type { Opportunity } from "./opportunity.js";
import type { PipelineStage } from "./pipeline-stage.js";

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    title: "فرصة الفا",
    customerId: "cust-1",
    branchId: null,
    stageId: "stage-1",
    expectedValue: Money.fromMajor("1000.00"),
    probability: 20,
    expectedCloseDate: null,
    notes: null,
    ownerUserId: null,
    lostReason: null,
    lostNote: null,
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

function stage(overrides: Partial<PipelineStage> = {}): PipelineStage {
  return {
    id: "stage-2",
    name: "عرض سعر",
    order: 1,
    defaultProbability: 40,
    color: "#3b82f6",
    isWinStage: false,
    isLossStage: false,
    active: true,
    ...overrides,
  };
}

describe("moveOpportunityStage", () => {
  it("adopts the target stage's id and default probability for an open stage", () => {
    const next = moveOpportunityStage(opportunity(), stage());
    expect(next.stageId).toBe("stage-2");
    expect(next.probability).toBe(40);
    expect(next.status).toBe("open");
    expect(next.closedAt).toBeNull();
  });

  it("marks the opportunity 'won' when moved to a win stage", () => {
    const next = moveOpportunityStage(opportunity(), stage({ id: "stage-win", isWinStage: true, defaultProbability: 100 }));
    expect(next.status).toBe("won");
    expect(next.probability).toBe(100);
  });

  it("marks the opportunity 'lost' with its reason and trimmed note when moved to a loss stage", () => {
    const next = moveOpportunityStage(opportunity(), stage({ id: "stage-loss", isLossStage: true, defaultProbability: 0 }), undefined, {
      reason: OpportunityLostReason.Price,
      note: "  أرخص عند المنافس  ",
    });
    expect(next.status).toBe("lost");
    expect(next.lostReason).toBe(OpportunityLostReason.Price);
    expect(next.lostNote).toBe("أرخص عند المنافس");
  });

  it("refuses a loss stage without a reason from the managed list", () => {
    const loss = stage({ id: "stage-loss", isLossStage: true });
    expect(() => moveOpportunityStage(opportunity(), loss)).toThrow(InvalidOpportunityError);
    expect(() => moveOpportunityStage(opportunity(), loss, undefined, { reason: "FREE_TEXT" })).toThrow(InvalidOpportunityError);
  });

  it("clears the loss when the deal is moved back to an open stage", () => {
    const lost = opportunity({ status: "lost", lostReason: OpportunityLostReason.Timing, lostNote: "x" });
    const next = moveOpportunityStage(lost, stage());
    expect(next.status).toBe("open");
    expect(next.lostReason).toBeNull();
    expect(next.lostNote).toBeNull();
  });

  it("stamps closedAt only when 'now' is supplied and the stage is win/loss", () => {
    const winStage = stage({ id: "stage-win", isWinStage: true });
    const withoutNow = moveOpportunityStage(opportunity(), winStage);
    expect(withoutNow.closedAt).toBeNull();

    const withNow = moveOpportunityStage(opportunity(), winStage, "2026-02-01T00:00:00.000Z");
    expect(withNow.closedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("does not stamp closedAt for an open stage even when 'now' is supplied", () => {
    const next = moveOpportunityStage(opportunity(), stage(), "2026-02-01T00:00:00.000Z");
    expect(next.closedAt).toBeNull();
  });
});
