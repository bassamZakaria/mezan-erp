import { InvalidOpportunityError } from "./errors.js";
import { isOpportunityLostReason, type OpportunityLostReason } from "./lost-reason.js";
import type { Opportunity } from "./opportunity.js";
import type { PipelineStage } from "./pipeline-stage.js";

export interface OpportunityLoss {
  readonly reason: string | null | undefined;
  readonly note?: string | null;
}

/**
 * Moves an opportunity to a new pipeline stage: adopts the stage's default
 * probability, and flips `status`/`closedAt` when the stage is a win/loss
 * terminal stage. Pure — the caller persists via `repo.update`. `closedAt`
 * is only stamped when the caller supplies `now` (so callers that don't care
 * about the close timestamp, e.g. tests, can omit it).
 *
 * A loss stage demands a reason from the managed list; any other stage clears
 * the reason and note, so a deal reopened later carries no stale loss.
 */
export function moveOpportunityStage(opportunity: Opportunity, stage: PipelineStage, now?: string, loss?: OpportunityLoss): Opportunity {
  const status = stage.isWinStage ? "won" : stage.isLossStage ? "lost" : "open";
  const closedAt = now !== undefined && (stage.isWinStage || stage.isLossStage) ? now : null;

  let lostReason: OpportunityLostReason | null = null;
  let lostNote: string | null = null;
  if (stage.isLossStage) {
    if (!loss?.reason || !isOpportunityLostReason(loss.reason)) {
      throw new InvalidOpportunityError([
        { ar: "سبب الخسارة مطلوب عند إغلاق الفرصة كخاسرة", en: "A lost reason is required when closing the opportunity as lost" },
      ]);
    }
    lostReason = loss.reason;
    const note = loss.note?.trim() ?? "";
    lostNote = note === "" ? null : note;
  }

  return {
    ...opportunity,
    stageId: stage.id,
    probability: stage.defaultProbability,
    status,
    closedAt,
    lostReason,
    lostNote,
  };
}
