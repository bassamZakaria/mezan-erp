import { describe, it, expect } from "vitest";
import { createInMemoryPipelineStageRepository } from "./test-helpers/in-memory-crm-repositories.js";
import { createPipelineStage, movePipelineStage, type PipelineStage } from "./pipeline-stage.js";
import { DuplicatePipelineStageWinError, PipelineStageNotFoundError } from "./errors.js";

function stage(overrides: Partial<PipelineStage> & Pick<PipelineStage, "id" | "order">): PipelineStage {
  return {
    name: overrides.id,
    defaultProbability: 50,
    color: "#3b82f6",
    isWinStage: false,
    isLossStage: false,
    active: true,
    ...overrides,
  };
}

describe("createPipelineStage", () => {
  it("creates a stage with defaults, appended at the end of the order", async () => {
    const repo = createInMemoryPipelineStageRepository();
    const first = await createPipelineStage({ id: "s1", name: "عميل محتمل" }, [], repo);
    expect(first.order).toBe(0);

    const second = await createPipelineStage({ id: "s2", name: "تواصل أولي" }, [first], repo);
    expect(second.order).toBe(1);
    expect(second.defaultProbability).toBe(50);
    expect(second.color).toBe("#3b82f6");
    expect(second.active).toBe(true);
  });

  it("allows a win stage when none exists yet", async () => {
    const repo = createInMemoryPipelineStageRepository();
    const win = await createPipelineStage({ id: "s1", name: "تم الإغلاق", isWinStage: true }, [], repo);
    expect(win.isWinStage).toBe(true);
  });

  it("rejects a second active win stage", async () => {
    const repo = createInMemoryPipelineStageRepository();
    const existing = [stage({ id: "s1", order: 0, isWinStage: true })];
    await expect(
      createPipelineStage({ id: "s2", name: "مرحلة أخرى", isWinStage: true }, existing, repo),
    ).rejects.toThrow(DuplicatePipelineStageWinError);
  });

  it("allows a new win stage when the existing win stage is inactive", async () => {
    const repo = createInMemoryPipelineStageRepository();
    const existing = [stage({ id: "s1", order: 0, isWinStage: true, active: false })];
    const created = await createPipelineStage({ id: "s2", name: "مرحلة أخرى", isWinStage: true }, existing, repo);
    expect(created.isWinStage).toBe(true);
  });
});

describe("movePipelineStage", () => {
  const stages = [
    stage({ id: "s1", order: 0 }),
    stage({ id: "s2", order: 1 }),
    stage({ id: "s3", order: 2 }),
  ];

  it("moves a stage up, swapping order with its predecessor", () => {
    const reordered = movePipelineStage(stages, "s2", "up");
    const byId = new Map(reordered.map((s) => [s.id, s.order]));
    expect(byId.get("s2")).toBe(0);
    expect(byId.get("s1")).toBe(1);
    expect(byId.get("s3")).toBe(2);
  });

  it("moves a stage down, swapping order with its successor", () => {
    const reordered = movePipelineStage(stages, "s2", "down");
    const byId = new Map(reordered.map((s) => [s.id, s.order]));
    expect(byId.get("s2")).toBe(2);
    expect(byId.get("s3")).toBe(1);
    expect(byId.get("s1")).toBe(0);
  });

  it("throws at the top boundary (moving the first stage up)", () => {
    expect(() => movePipelineStage(stages, "s1", "up")).toThrow(PipelineStageNotFoundError);
  });

  it("throws at the bottom boundary (moving the last stage down)", () => {
    expect(() => movePipelineStage(stages, "s3", "down")).toThrow(PipelineStageNotFoundError);
  });

  it("throws for an unknown stage id", () => {
    expect(() => movePipelineStage(stages, "does-not-exist", "up")).toThrow(PipelineStageNotFoundError);
  });
});
