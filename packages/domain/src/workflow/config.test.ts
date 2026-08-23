import { describe, it, expect } from "vitest";
import {
  saveWorkflowConfig,
  deleteWorkflowConfig,
  UnknownActionTypeError,
  EmptyStepsError,
  InvalidStepRoleError,
  DuplicateWorkflowConfigError,
  WorkflowConfigNotFoundError,
  type WorkflowConfigRecord,
  type WorkflowConfigRepository,
} from "./config.js";

function fakeRepo(): WorkflowConfigRepository & { readonly rows: Map<string, WorkflowConfigRecord> } {
  const rows = new Map<string, WorkflowConfigRecord>();
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByActionType(actionType) {
      return [...rows.values()].find((r) => r.actionType === actionType) ?? null;
    },
    async save(record) {
      rows.set(record.id, record);
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

describe("saveWorkflowConfig", () => {
  it("creates a config for a valid gateable action type", async () => {
    const repo = fakeRepo();
    const record = await saveWorkflowConfig(
      {
        id: "cfg-1",
        actionType: "SALES_INVOICE_CONFIRM",
        steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER", description: "مراجعة مالية" }],
        createdAt: "2026-08-08T00:00:00.000Z",
      },
      repo,
    );
    expect(record.steps).toHaveLength(2);
    expect(await repo.findById("cfg-1")).toEqual(record);
  });

  it("rejects an action type outside the 26-entry catalog", async () => {
    const repo = fakeRepo();
    await expect(
      saveWorkflowConfig({ id: "cfg-1", actionType: "NOT_A_REAL_ACTION", steps: [{ role: "SUPERVISOR" }], createdAt: "2026-08-08T00:00:00.000Z" }, repo),
    ).rejects.toBeInstanceOf(UnknownActionTypeError);
  });

  it("rejects a config with no steps", async () => {
    const repo = fakeRepo();
    await expect(
      saveWorkflowConfig({ id: "cfg-1", actionType: "SALES_INVOICE_CONFIRM", steps: [], createdAt: "2026-08-08T00:00:00.000Z" }, repo),
    ).rejects.toBeInstanceOf(EmptyStepsError);
  });

  it("rejects a step with a blank role", async () => {
    const repo = fakeRepo();
    await expect(
      saveWorkflowConfig(
        { id: "cfg-1", actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "  " }], createdAt: "2026-08-08T00:00:00.000Z" },
        repo,
      ),
    ).rejects.toBeInstanceOf(InvalidStepRoleError);
  });

  it("rejects a second config for the same action type", async () => {
    const repo = fakeRepo();
    await saveWorkflowConfig(
      { id: "cfg-1", actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }], createdAt: "2026-08-08T00:00:00.000Z" },
      repo,
    );
    await expect(
      saveWorkflowConfig(
        { id: "cfg-2", actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "FINANCE_MANAGER" }], createdAt: "2026-08-08T00:00:00.000Z" },
        repo,
      ),
    ).rejects.toBeInstanceOf(DuplicateWorkflowConfigError);
  });

  it("allows updating the same config by id under its own action type", async () => {
    const repo = fakeRepo();
    await saveWorkflowConfig(
      { id: "cfg-1", actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }], createdAt: "2026-08-08T00:00:00.000Z" },
      repo,
    );
    const updated = await saveWorkflowConfig(
      {
        id: "cfg-1",
        actionType: "SALES_INVOICE_CONFIRM",
        steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }],
        createdAt: "2026-08-09T00:00:00.000Z",
      },
      repo,
    );
    expect(updated.steps).toHaveLength(2);
    expect(updated.createdAt).toBe("2026-08-08T00:00:00.000Z");
  });
});

describe("deleteWorkflowConfig", () => {
  it("deletes an existing config", async () => {
    const repo = fakeRepo();
    await saveWorkflowConfig(
      { id: "cfg-1", actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: "SUPERVISOR" }], createdAt: "2026-08-08T00:00:00.000Z" },
      repo,
    );
    await deleteWorkflowConfig("cfg-1", repo);
    expect(await repo.findById("cfg-1")).toBeNull();
  });

  it("rejects deleting an unknown config", async () => {
    const repo = fakeRepo();
    await expect(deleteWorkflowConfig("nope", repo)).rejects.toBeInstanceOf(WorkflowConfigNotFoundError);
  });
});
