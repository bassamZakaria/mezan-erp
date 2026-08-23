import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Money, Qty, type WritedownRun } from "@mezan/domain";
import { createSqliteWritedownRunRepository } from "./writedown-run-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function run(overrides: Partial<WritedownRun> = {}): WritedownRun {
  return {
    id: "run-1",
    period: "2026-03",
    warehouseId: null,
    status: "draft",
    lines: [
      {
        itemId: "item-a",
        warehouseId: "wh-1",
        onHandQty: Qty.fromMajor("20"),
        unitCost: Money.fromMajor("100.00"),
        agingDays: 211,
        writedownRateBps: 2_500,
        amount: Money.fromMajor("500.500000"),
      },
      {
        itemId: "item-b",
        warehouseId: "wh-1",
        onHandQty: Qty.fromMajor("5.5"),
        unitCost: Money.fromMajor("40.00"),
        agingDays: 400,
        writedownRateBps: 5_000,
        amount: Money.fromMajor("110.00"),
      },
    ],
    totalAmount: Money.fromMajor("610.50"),
    journalEntryId: null,
    createdAt: "2026-03-31T00:00:00.000Z",
    postedAt: null,
    ...overrides,
  };
}

describe("SqliteWritedownRunRepository", () => {
  it("creates and retrieves a run by id, round-tripping the lines JSON exactly (2+ lines)", async () => {
    const repo = createSqliteWritedownRunRepository();
    handles.push(repo);
    await repo.create(run());
    const reloaded = await repo.findById("run-1");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.lines).toHaveLength(2);
    expect(reloaded?.lines[0]?.itemId).toBe("item-a");
    expect(reloaded?.lines[0]?.onHandQty.toString()).toBe("20.000000");
    expect(reloaded?.lines[0]?.amount.toString()).toBe("500.500000");
    expect(reloaded?.lines[1]?.onHandQty.toString()).toBe("5.500000");
    expect(reloaded?.lines[1]?.agingDays).toBe(400);
    expect(reloaded?.lines[1]?.writedownRateBps).toBe(5_000);
    expect(reloaded?.totalAmount.toString()).toBe("610.500000");
  });

  it("findByPeriod finds a run for a given period + warehouse scope (including null = every warehouse)", async () => {
    const repo = createSqliteWritedownRunRepository();
    handles.push(repo);
    await repo.create(run());
    await repo.create(run({ id: "run-2", period: "2026-03", warehouseId: "wh-1" }));
    expect((await repo.findByPeriod("2026-03", null))?.id).toBe("run-1");
    expect((await repo.findByPeriod("2026-03", "wh-1"))?.id).toBe("run-2");
    expect(await repo.findByPeriod("2026-03", "wh-2")).toBeNull();
    expect(await repo.findByPeriod("2026-04", null)).toBeNull();
  });

  it("update() persists a full replace (e.g. posting: status/journalEntryId/postedAt)", async () => {
    const repo = createSqliteWritedownRunRepository();
    handles.push(repo);
    await repo.create(run());
    await repo.update({ ...run(), status: "posted", journalEntryId: "WRITEDOWN-JE:run-1", postedAt: "2026-03-31T12:00:00.000Z" });
    const reloaded = await repo.findById("run-1");
    expect(reloaded?.status).toBe("posted");
    expect(reloaded?.journalEntryId).toBe("WRITEDOWN-JE:run-1");
    expect(reloaded?.postedAt).toBe("2026-03-31T12:00:00.000Z");
  });

  it("list() returns every persisted run", async () => {
    const repo = createSqliteWritedownRunRepository();
    handles.push(repo);
    await repo.create(run());
    await repo.create(run({ id: "run-2", period: "2026-04" }));
    const all = await repo.list();
    expect(all.map((r) => r.id).sort()).toEqual(["run-1", "run-2"]);
  });

  it("survives a reopen against the same file path (real persistence, not just in-process)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mezan-writedown-"));
    const file = join(dir, "writedown.db");
    try {
      const repo1 = createSqliteWritedownRunRepository(file);
      await repo1.create(run());
      repo1.close();

      const repo2 = createSqliteWritedownRunRepository(file);
      handles.push(repo2);
      const reloaded = await repo2.findById("run-1");
      expect(reloaded?.status).toBe("draft");
      expect(reloaded?.totalAmount.toString()).toBe("610.500000");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
