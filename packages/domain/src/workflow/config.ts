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

/**
 * A step names an approver role that does not exist.
 *
 * WHY THIS EXISTS. `gate.ts` authorizes an approval by ROLE CODE
 * (`actorRoles.includes(step.role)`), and this module used to require only
 * that the code be a non-empty STRING — so there was no referential integrity
 * at all between a workflow step and the roles table. That was a
 * single-person create-and-approve path on treasury payments, reachable with
 * two permissions no owner thinks of as dangerous:
 *
 *   1. delete the approver role, if it happens to have no holder — the common
 *      SMB case, where the owner approves as a company admin with a null
 *      roleId, and `RoleInUseError` does not consider an unassigned role "in
 *      use";
 *   2. create a new role with the SAME code and an empty permission list,
 *      which passes the ungrantable check trivially;
 *   3. assign it to yourself, which passes the escalation check because an
 *      empty list contains nothing you lack;
 *   4. sign in again and approve your own payment voucher.
 *
 * Requiring the role to resolve closes step 2's target: the code can never
 * become free, because the roles routes refuse to delete or rename a role a
 * config names.
 */
export class UnknownStepRoleError extends Error {
  readonly code = "UNKNOWN_STEP_ROLE" as const;
  constructor(readonly index: number, readonly role: string) {
    super(`Step ${index + 1} names an approver role that does not exist: "${role}".`);
    this.name = "UnknownStepRoleError";
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
 * Resolves an approver role code to something real.
 *
 * A callback rather than the `RoleRepository` port, because the workflow module
 * has never depended on roles and should not start: it needs one yes/no answer,
 * not a repository.
 */
export type ApproverRoleResolver = (code: string) => Promise<boolean>;

/**
 * Creates or updates the ONE workflow config for an action type. Rejects an
 * action type outside the 26-entry catalog, a config with no steps, a step
 * missing its approver role, and — on create — a second config for an action
 * type that already has one (edit the existing config instead).
 */
export async function saveWorkflowConfig(
  cmd: SaveWorkflowConfigCommand,
  repo: WorkflowConfigRepository,
  /** Omit and step roles are not checked against the roles table (existing callers/tests). */
  roleExists?: ApproverRoleResolver,
): Promise<WorkflowConfigRecord> {
  if (!isGateableActionType(cmd.actionType)) throw new UnknownActionTypeError(cmd.actionType);
  assertValidSteps(cmd.steps);
  if (roleExists) {
    for (const [index, step] of cmd.steps.entries()) {
      if (!(await roleExists(step.role))) throw new UnknownStepRoleError(index, step.role);
    }
  }

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
