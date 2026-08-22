import { DuplicatePipelineStageWinError, PipelineStageNotFoundError } from "./errors.js";

/**
 * Pipeline stages — core entity (docs/catalog/06-crm-hr.md "مراحل خط
 * المبيعات"). An ordered, reorderable list of stages an `Opportunity` moves
 * through; exactly one active stage may be flagged as the win stage, and
 * marks the deal `won` when an opportunity reaches it.
 */

export interface PipelineStage {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly defaultProbability: number;
  readonly color: string;
  readonly isWinStage: boolean;
  readonly isLossStage: boolean;
  readonly active: boolean;
}

/** Persistence port for pipeline stages. The domain depends on this interface only — no SQL, no driver. */
export interface PipelineStageRepository {
  findById(id: string): Promise<PipelineStage | null>;
  list(): Promise<PipelineStage[]>;
  create(stage: PipelineStage): Promise<void>;
  update(stage: PipelineStage): Promise<void>;
}

export interface CreatePipelineStageCommand {
  readonly id: string;
  readonly name: string;
  readonly defaultProbability?: number;
  readonly color?: string;
  readonly isWinStage?: boolean;
  readonly isLossStage?: boolean;
}

/**
 * Creates and persists a new pipeline stage, appended at the end of the
 * existing order. Only one active stage may be flagged as the win stage
 * (catalog helper text: "مرحلة الفوز واحدة فقط لكل عميل").
 */
export async function createPipelineStage(
  command: CreatePipelineStageCommand,
  existing: readonly PipelineStage[],
  repo: PipelineStageRepository,
): Promise<PipelineStage> {
  const isWinStage = command.isWinStage ?? false;
  if (isWinStage && existing.some((s) => s.active && s.isWinStage)) {
    throw new DuplicatePipelineStageWinError();
  }

  const stage: PipelineStage = {
    id: command.id,
    name: command.name,
    order: existing.length,
    defaultProbability: command.defaultProbability ?? 50,
    color: command.color ?? "#3b82f6",
    isWinStage,
    isLossStage: command.isLossStage ?? false,
    active: true,
  };

  await repo.create(stage);
  return stage;
}

/**
 * Reorders `stages` by moving `stageId` one position up or down (swapping
 * `order` with its neighbor). A no-op is not allowed at either boundary —
 * moving the first stage "up" or the last stage "down" throws, mirroring the
 * catalog UI's disabled arrow buttons at the ends of the list.
 */
export function movePipelineStage(
  stages: readonly PipelineStage[],
  stageId: string,
  direction: "up" | "down",
): readonly PipelineStage[] {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((s) => s.id === stageId);
  if (index === -1) throw new PipelineStageNotFoundError(stageId);

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= sorted.length) {
    throw new PipelineStageNotFoundError(stageId);
  }

  const current = sorted[index]!;
  const neighbor = sorted[swapWith]!;
  const reordered = [...sorted];
  reordered[index] = { ...neighbor, order: current.order };
  reordered[swapWith] = { ...current, order: neighbor.order };
  return reordered.sort((a, b) => a.order - b.order);
}
