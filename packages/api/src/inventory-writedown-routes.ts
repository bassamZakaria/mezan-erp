import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  createWritedownRun,
  postWritedownRun,
  WritedownRunNotFoundError,
  WritedownRunNotDraftError,
  DuplicateWritedownPeriodError,
  NoSlowMovingStockError,
  type WritedownRun,
  type WritedownRunRepository,
  type JournalPostingDeps,
} from "@mezan/domain";
import type { WacSnapshotRepository, StockLedgerRepository } from "@mezan/domain";
import { createWritedownRunSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Inventory aging-based write-down batch routes (docs/backlog.md Phase 4
 * "Aging-based inventory write-down batch"): manual trigger (draft) + post
 * (posts the REAL balanced GL entry). Root-relative — a parent app mounts
 * this router under `/inventory/writedown-runs`.
 */
export interface InventoryWritedownRoutesDeps {
  readonly runs: WritedownRunRepository;
  readonly wacSnapshots: WacSnapshotRepository;
  readonly stockLedger: StockLedgerRepository;
  readonly gl: JournalPostingDeps;
  readonly accounts: {
    readonly writedownExpenseAccountId: string;
    readonly provisionAccountId: string;
  };
  /** Generates ids when the request omits them. Defaults to `randomUUID`. */
  readonly idGen?: () => string;
}

function serializeRun(run: WritedownRun) {
  return {
    id: run.id,
    period: run.period,
    warehouseId: run.warehouseId,
    status: run.status,
    lines: run.lines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      onHandQty: l.onHandQty.toString(),
      unitCost: l.unitCost.toString(),
      agingDays: l.agingDays,
      writedownRateBps: l.writedownRateBps,
      amount: l.amount.toString(),
    })),
    totalAmount: run.totalAmount.toString(),
    journalEntryId: run.journalEntryId,
    createdAt: run.createdAt,
    postedAt: run.postedAt,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof WritedownRunNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateWritedownPeriodError || err instanceof WritedownRunNotDraftError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof NoSlowMovingStockError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

export function createInventoryWritedownRoutes(
  deps: InventoryWritedownRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;

  app.get("/", gate("inventory.writedown.view"), async (c) => {
    const runs = await deps.runs.list();
    return c.json(runs.map(serializeRun));
  });

  app.post("/", gate("inventory.writedown.run"), async (c) => {
    const parsed = createWritedownRunSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const run = await createWritedownRun(
        { id: idGen(), period: parsed.data.period, warehouseId: parsed.data.warehouseId ?? null },
        { runs: deps.runs, wacSnapshots: deps.wacSnapshots, stockLedger: deps.stockLedger },
      );
      return c.json(serializeRun(run), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate("inventory.writedown.view"), async (c) => {
    const run = await deps.runs.findById(c.req.param("id"));
    if (!run) return c.json({ error: "WRITEDOWN_RUN_NOT_FOUND" }, 404);
    return c.json(serializeRun(run));
  });

  app.post("/:id/post", gate("inventory.writedown.run"), async (c) => {
    try {
      const run = await postWritedownRun(c.req.param("id"), {
        runs: deps.runs,
        gl: deps.gl,
        accounts: deps.accounts,
      });
      return c.json(serializeRun(run));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
