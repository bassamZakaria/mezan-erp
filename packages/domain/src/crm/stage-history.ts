import type { Opportunity } from "./opportunity.js";
import type { PipelineStage } from "./pipeline-stage.js";

export interface OpportunityStageEntry {
  readonly opportunityId: string;
  readonly stageId: string;
  readonly enteredAt: string;
}

export interface OpportunityStageHistorySource {
  entries(): Promise<readonly OpportunityStageEntry[]>;
}

export interface StageDwellSegment {
  readonly opportunityId: string;
  readonly stageId: string;
  readonly enteredAt: string;
  readonly leftAt: string | null;
}

const MS_PER_DAY = 86_400_000;

export function wholeDaysBetween(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.floor((end - start) / MS_PER_DAY);
}

/**
 * One deal's walk through the pipeline. A deal written before stage history
 * existed has no entries: it is read as having entered its current stage when
 * it was created, which is the longest the deal can have sat there.
 */
export function dwellSegments(opportunity: Opportunity, entries: readonly OpportunityStageEntry[]): readonly StageDwellSegment[] {
  const own = entries.filter((e) => e.opportunityId === opportunity.id);
  const walk = own.length > 0 ? own : [{ opportunityId: opportunity.id, stageId: opportunity.stageId, enteredAt: opportunity.createdAt }];
  return walk.map((entry, index) => ({
    opportunityId: entry.opportunityId,
    stageId: entry.stageId,
    enteredAt: entry.enteredAt,
    leftAt: walk[index + 1]?.enteredAt ?? null,
  }));
}

export function isTerminalStage(stage: PipelineStage | undefined): boolean {
  return stage !== undefined && (stage.isWinStage || stage.isLossStage);
}
