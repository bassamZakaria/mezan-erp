import type { Opportunity } from "./opportunity.js";
import type { PipelineStage } from "./pipeline-stage.js";

/**
 * Closes a deal as won because its quote was accepted. Pure. An already-won
 * deal is returned untouched so a replayed event changes nothing; a deal that
 * was marked lost is reopened as won, because the customer's acceptance is the
 * later fact. `winStage` is the pipeline's active win stage — absent, only the
 * status flips and the stage stays where the rep left it.
 */
export function winOpportunity(opportunity: Opportunity, winStage: PipelineStage | null, now: string): Opportunity {
  if (opportunity.status === "won") return opportunity;
  return {
    ...opportunity,
    stageId: winStage?.id ?? opportunity.stageId,
    probability: winStage?.defaultProbability ?? 100,
    status: "won",
    closedAt: now,
    lostReason: null,
    lostNote: null,
  };
}
