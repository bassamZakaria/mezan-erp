/**
 * Workflow config management — CRUD over the persisted {@link GateConfig} per
 * action type that backs `/settings/workflow`'s chain-builder screen. Thin
 * orchestration on top of the pure `action-types.ts` catalog: validates the
 * action type is one of the 26 gateable codes and that a config isn't
 * silently duplicated for the same action type, then hands off to the port.
 */

import { isGateableActionType, type GateableActionType } from "./action-types.js";
import type { GateStep } from "./gate.js";

export interface WorkflowConfigRecord {
  readonly id: string;
  readonly actionType: GateableActionType;
  readonly steps: readonly GateStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Persistence port for workflow configs. The domain depends on this interface only. */
export interface WorkflowConfigRepository {
  list(): Promise<readonly WorkflowConfigRecord[]>;
  findById(id: string): Promise<WorkflowConfigRecord | null>;
  findByActionType(actionType: GateableActionType): Promise<WorkflowConfigRecord | null>;
  save(record: WorkflowConfigRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export class UnknownActionTypeError extends Error {
  readonly code = "UNKNOWN_ACTION_TYPE" as const;
  constructor(readonly actionType: string) {
    super(`"${actionType}" is not one of the 26 gateable action types.`);
    this.name = "UnknownActionTypeError";
  }
}

export class EmptyStepsError extends Error {
  readonly code = "EMPTY_STEPS" as const;
  constructor() {
    super("A workflow config needs at least one step.");
    this.name = "EmptyStepsError";
  }
}

export class InvalidStepRoleError extends Error {
  readonly code = "INVALID_STEP_ROLE" as const;
  constructor(readonly index: number) {
    super(`Step ${index + 1} needs an approver role.`);
    this.name = "InvalidStepRoleError";
  }
}

export class DuplicateWorkflowConfigError extends Error {
  readonly code = "DUPLICATE_WORKFLOW_CONFIG" as const;
  constructor(readonly actionType: string) {
    super(`A workflow config for "${actionType}" already exists.`);
    this.name = "DuplicateWorkflowConfigError";
  }
}

export class WorkflowConfigNotFoundError extends Error {
  readonly code = "WORKFLOW_CONFIG_NOT_FOUND" as const;
  constructor(readonly id: string) {
    super(`Workflow config "${id}" not found.`);
    this.name = "WorkflowConfigNotFoundError";
  }
}

export interface SaveWorkflowConfigCommand {
  readonly id: string;
  readonly actionType: string;
  readonly steps: readonly GateStep[];
  readonly createdAt: string;
}

function assertValidSteps(steps: readonly GateStep[]): void {
  if (steps.length === 0) throw new EmptyStepsError();
  steps.forEach((step, index) => {
    if (!step.role || step.role.trim() === "") throw new InvalidStepRoleError(index);
  });
}

/**
 * Creates or updates the ONE workflow config for an action type. Rejects an
 * action type outside the 26-entry catalog, a config with no steps, a step
 * missing its approver role, and — on create — a second config for an action
 * type that already has one (edit the existing config instead).
 */
export async function saveWorkflowConfig(
  cmd: SaveWorkflowConfigCommand,
  repo: WorkflowConfigRepository,
): Promise<WorkflowConfigRecord> {
  if (!isGateableActionType(cmd.actionType)) throw new UnknownActionTypeError(cmd.actionType);
  assertValidSteps(cmd.steps);

  const existingForAction = await repo.findByActionType(cmd.actionType);
  if (existingForAction && existingForAction.id !== cmd.id) {
    throw new DuplicateWorkflowConfigError(cmd.actionType);
  }

  const existingById = await repo.findById(cmd.id);
  const record: WorkflowConfigRecord = {
    id: cmd.id,
    actionType: cmd.actionType,
    steps: cmd.steps,
    createdAt: existingById?.createdAt ?? cmd.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await repo.save(record);
  return record;
}

export async function deleteWorkflowConfig(id: string, repo: WorkflowConfigRepository): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new WorkflowConfigNotFoundError(id);
  await repo.delete(id);
}
