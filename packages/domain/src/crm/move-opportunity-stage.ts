import type { Opportunity } from "./opportunity.js";
import type { PipelineStage } from "./pipeline-stage.js";

/**
 * Moves an opportunity to a new pipeline stage: adopts the stage's default
 * probability, and flips `status`/`closedAt` when the stage is a win/loss
 * terminal stage. Pure — the caller persists via `repo.update`. `closedAt`
 * is only stamped when the caller supplies `now` (so callers that don't care
 * about the close timestamp, e.g. tests, can omit it).
 */
export function moveOpportunityStage(opportunity: Opportunity, stage: PipelineStage, now?: string): Opportunity {
  const status = stage.isWinStage ? "won" : stage.isLossStage ? "lost" : "open";
  const closedAt = now !== undefined && (stage.isWinStage || stage.isLossStage) ? now : null;

  return {
    ...opportunity,
    stageId: stage.id,
    probability: stage.defaultProbability,
    status,
    closedAt,
  };
}
