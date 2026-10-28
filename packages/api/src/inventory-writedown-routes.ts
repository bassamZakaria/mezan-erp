import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  createWritedownRun,
  createDefaultSettings,
  tenantAgingPolicy,
  postWritedownRun,
  reverseWritedownRun,
  WritedownRunNotPostedError,
  WritedownRunNotFoundError,
  WritedownRunNotDraftError,
  DuplicateWritedownPeriodError,
  NoSlowMovingStockError,
  type WritedownRun,
  type WritedownRunRepository,
  type JournalPostingDeps,
  type WarehouseBranchLookup,
  type SettingsRepository,
} from "@mezan/domain";
import type { WacSnapshotRepository, StockLedgerRepository } from "@mezan/domain";
import { ReversalPermission, createWritedownRunSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, withItemCost, type AuthContextResolver } from "./permission-gate.js";
import { readReversalRequest, reversalRefusalResponse, requireReversalReason } from "./document-reversal.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * Inventory aging-based write-down batch routes (docs/archive/phase-backlog.md Phase 4
 * "Aging-based inventory write-down batch"): manual trigger (draft) + post
 * (posts the REAL balanced GL entry). Root-relative — a parent app mounts
 * this router under `/inventory/writedown-runs`.
 */
export interface InventoryWritedownRoutesDeps {
  /** Refuses a run naming a warehouse no master record holds (D310). */
  readonly masterData?: MasterDataChecks;
  readonly runs: WritedownRunRepository;
  readonly wacSnapshots: WacSnapshotRepository;
  readonly stockLedger: StockLedgerRepository;
  readonly gl: JournalPostingDeps;
  readonly warehouses?: WarehouseBranchLookup;
  readonly accounts: {
    readonly writedownExpenseAccountId: string;
    readonly provisionAccountId: string;
  };
  /** Generates ids when the request omits them. Defaults to `randomUUID`. */
  readonly idGen?: () => string;
  /**
   * Tenant settings §"سياسة المخزون" — مخصص هبوط المخزون الراكد. Present means
   * the run obeys the tenant's own idle-months + rate, and is refused outright
   * while the provision is switched off. Absent falls back to the shipped bands.
   */
  readonly settings?: SettingsRepository;
}

const WRITEDOWN_COST_KEYS = ["unitCost", "amount", "totalAmount"];

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
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const reversalRefusal = reversalRefusalResponse(c, err);
  if (reversalRefusal) return reversalRefusal;
  if (err instanceof WritedownRunNotPostedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
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
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;

  app.get("/", gate("inventory.writedown.view"), async (c) => {
    const runs = await deps.runs.list();
    return c.json(withItemCost(c, runs.map(serializeRun), WRITEDOWN_COST_KEYS));
  });

  app.post("/", gate("inventory.writedown.run"), async (c) => {
    const parsed = createWritedownRunSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const warehouseRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Warehouse, ids: [parsed.data.warehouseId] },
    ]);
    if (warehouseRefusal) return warehouseRefusal;
    const period = parsed.data.period;
    let policy = undefined;
    if (deps.settings) {
      const settings = (await deps.settings.get()) ?? createDefaultSettings();
      if (!settings.agingWritedownEnabled) {
        return c.json(
          {
            error: "AGING_WRITEDOWN_DISABLED",
            message: "مخصص هبوط المخزون الراكد غير مُفعَّل في إعدادات سياسة المخزون.",
          },
          422,
        );
      }
      policy = tenantAgingPolicy(period, settings.agingWritedownMonths, settings.agingWritedownRatePercent);
    }
    try {
      const run = await createWritedownRun(
        { id: idGen(), period, warehouseId: parsed.data.warehouseId ?? null, policy },
        { runs: deps.runs, wacSnapshots: deps.wacSnapshots, stockLedger: deps.stockLedger },
      );
      return c.json(withItemCost(c, serializeRun(run), WRITEDOWN_COST_KEYS), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate("inventory.writedown.view"), async (c) => {
    const run = await deps.runs.findById(c.req.param("id"));
    if (!run) return c.json({ error: "WRITEDOWN_RUN_NOT_FOUND" }, 404);
    return c.json(withItemCost(c, serializeRun(run), WRITEDOWN_COST_KEYS));
  });

  app.post("/:id/post", gate("inventory.writedown.run"), async (c) => {
    try {
      const run = await postWritedownRun(c.req.param("id"), {
        runs: deps.runs,
        gl: deps.gl,
        warehouses: deps.warehouses,
        accounts: deps.accounts,
      });
      return c.json(withItemCost(c, serializeRun(run), WRITEDOWN_COST_KEYS));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/reverse", gate(ReversalPermission.WritedownRun), requireReversalReason, async (c) => {
    try {
      const { date, memo } = await readReversalRequest(c);
      const run = await reverseWritedownRun(
        c.req.param("id"),
        { runs: deps.runs, gl: { ...deps.gl, actor: getAuthContext(c)?.userId ?? "system" } },
        { reversalId: idGen(), date, memo },
      );
      return c.json(withItemCost(c, serializeRun(run), WRITEDOWN_COST_KEYS));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
