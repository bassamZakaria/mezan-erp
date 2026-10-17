import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { OpportunityLostReason } from "./lost-reason.js";
import type { Opportunity } from "./opportunity.js";
import type { PipelineStage } from "./pipeline-stage.js";
import { winOpportunity } from "./win-opportunity.js";

const NOW = "2026-10-17T09:00:00.000Z";

function deal(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    title: "فرصة",
    customerId: "cust-1",
    branchId: null,
    stageId: "stage-2",
    expectedValue: Money.fromMajor("1000"),
    probability: 60,
    expectedCloseDate: null,
    notes: null,
    ownerUserId: "rep-a",
    lostReason: null,
    lostNote: null,
    status: "open",
    createdAt: "2026-10-01T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

const winStage: PipelineStage = {
  id: "stage-win",
  name: "فوز",
  order: 5,
  defaultProbability: 100,
  color: "#16a34a",
  isWinStage: true,
  isLossStage: false,
  active: true,
};

describe("winOpportunity", () => {
  it("moves an open deal to the win stage and stamps the close", () => {
    const won = winOpportunity(deal(), winStage, NOW);
    expect(won).toMatchObject({ status: "won", stageId: "stage-win", probability: 100, closedAt: NOW });
  });

  it("leaves an already-won deal untouched, so a replayed event changes nothing", () => {
    const already = deal({ status: "won", closedAt: "2026-10-10T00:00:00.000Z" });
    expect(winOpportunity(already, winStage, NOW)).toBe(already);
  });

  it("reopens a lost deal as won and drops the loss", () => {
    const lost = deal({ status: "lost", lostReason: OpportunityLostReason.Price, lostNote: "غالي" });
    const won = winOpportunity(lost, winStage, NOW);
    expect(won.status).toBe("won");
    expect(won.lostReason).toBeNull();
    expect(won.lostNote).toBeNull();
  });

  it("flips only the status when the pipeline has no win stage", () => {
    const won = winOpportunity(deal(), null, NOW);
    expect(won).toMatchObject({ status: "won", stageId: "stage-2", probability: 100 });
  });
});
