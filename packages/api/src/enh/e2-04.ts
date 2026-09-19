import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  AuditChangeAction,
  ExpiryStatus,
  Money,
  Qty,
  createInventoryBatchesReport,
  expiredWriteOffLines,
  previewFefo,
  runReport,
  summarizeBatchStock,
  toTenantDay,
  type AuditSink,
  type BatchTrailEntry,
  type BatchTrailRepository,
  type CostLayer,
  type CostLayerRepository,
  type ExpiredWriteOffLine,
  type ExpiryStore,
  type Item,
  type StockLedgerRepository,
  type Warehouse,
} from "@mezan/domain";
import {
  expirySettingsSchema,
  expiryWriteOffRequestSchema,
  fefoPreviewQuerySchema,
  type ExpiredWriteOffLineDTO,
} from "@mezan/contracts";
import {
  createAnyPermissionGate,
  createPermissionGate,
  getAuthContext,
  warehouseScopeOf,
  withinScope,
  type AuthContextResolver,
} from "../permission-gate.js";
import { recordFieldChanges } from "../admin-audit.js";

export const EXPIRY_VIEW_PERMISSION = "inventory.expiry.view";
export const EXPIRY_MANAGE_PERMISSION = "inventory.expiry.manage";

export interface ExpiryRoutesDeps {
  readonly items: { list(): Promise<readonly Item[]>; findById(id: string): Promise<Item | null> };
  readonly warehouses: { findAll(): Promise<readonly Warehouse[]> };
  readonly layers: CostLayerRepository;
  readonly stockLedger: StockLedgerRepository;
  readonly trail: BatchTrailRepository;
  readonly store: ExpiryStore;
  readonly audit?: AuditSink;
  readonly scan: () => Promise<number>;
  readonly forward: (path: string, init: RequestInit) => Promise<Response>;
  readonly today?: () => string;
  readonly now?: () => string;
}

export async function loadAllCostLayers(deps: Pick<ExpiryRoutesDeps, "layers" | "stockLedger">): Promise<readonly CostLayer[]> {
  if (deps.layers.listAll) return deps.layers.listAll();
  const positions = await deps.stockLedger.listPositions();
  const lists = await Promise.all(positions.map((p) => deps.layers.listByPosition(p.itemId, p.warehouseId)));
  return lists.flat();
}

function serializeTrail(entry: BatchTrailEntry) {
  return {
    movementId: entry.movementId,
    itemId: entry.itemId,
    warehouseId: entry.warehouseId,
    sourceDocType: entry.sourceDocType,
    sourceDocId: entry.sourceDocId,
    sourceDocNumber: entry.sourceDocNumber,
    batchNo: entry.batchNo,
    expiryDate: entry.expiryDate,
    qty: entry.qty.toString(),
    occurredAt: entry.occurredAt,
  };
}

function serializeWriteOffLine(line: ExpiredWriteOffLine): ExpiredWriteOffLineDTO {
  return {
    itemId: line.itemId,
    qty: line.qty.toString(),
    value: line.value.toString(),
    batches: line.batches.map((b) => ({
      batchNo: b.batchNo,
      expiryDate: b.expiryDate,
      qty: b.qty.toString(),
      value: b.value.toString(),
    })),
  };
}

function outOfScope(c: Context, warehouseId: string): Response | null {
  const scope = warehouseScopeOf(c);
  if (!scope || scope.includes(warehouseId)) return null;
  return c.json(
    {
      error: "WAREHOUSE_OUT_OF_SCOPE",
      warehouseId,
      message: `المستودع "${warehouseId}" خارج نطاق المستودعات المصرّح لك بها.`,
      messageEn: `Warehouse "${warehouseId}" is outside the warehouses you are allowed to use.`,
    },
    403,
  );
}

function forwardedHeaders(c: Context): Headers {
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return headers;
}

export function createExpiryRoutes(deps: ExpiryRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);
  const today = () => (deps.today ? deps.today() : toTenantDay(new Date().toISOString()));
  const now = () => (deps.now ? deps.now() : new Date().toISOString());

  async function scopedLayers(c: Context): Promise<readonly CostLayer[]> {
    return withinScope(await loadAllCostLayers(deps), warehouseScopeOf(c), (l) => l.warehouseId);
  }

  app.get("/settings", gate("inventory.stock.view"), async (c) => c.json(await deps.store.getSettings()));

  app.put("/settings", gate(EXPIRY_MANAGE_PERMISSION), async (c) => {
    const parsed = expirySettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: "INVALID_EXPIRY_SETTINGS",
          message: "عدد أيام التنبيه يجب أن يكون رقماً صحيحاً بين 1 و730.",
          messageEn: "The warning window must be a whole number of days between 1 and 730.",
          issues: parsed.error.issues,
        },
        400,
      );
    }
    const previous = await deps.store.getSettings();
    const next = {
      nearExpiryDays: parsed.data.nearExpiryDays,
      updatedAt: now(),
      updatedBy: getAuthContext(c)?.userId ?? null,
    };
    await deps.store.saveSettings(next);
    await recordFieldChanges(deps.audit, c, {
      entity: { module: "inventory", entityType: "expiry_settings", entityId: "default" },
      action: AuditChangeAction.Update,
      before: { nearExpiryDays: previous.nearExpiryDays },
      after: { nearExpiryDays: next.nearExpiryDays },
      fields: ["nearExpiryDays"],
    });
    await deps.scan();
    return c.json(next);
  });

  app.get("/alerts", gate(EXPIRY_VIEW_PERMISSION), async (c) => {
    await deps.scan();
    const [settings, layers, log] = await Promise.all([deps.store.getSettings(), scopedLayers(c), deps.store.listAlerts(200)]);
    const scope = warehouseScopeOf(c);
    const due = summarizeBatchStock(layers, { today: today(), nearExpiryDays: settings.nearExpiryDays }).filter(
      (r) => r.status === ExpiryStatus.Expired || r.status === ExpiryStatus.NearExpiry,
    );
    return c.json({
      asOf: today(),
      nearExpiryDays: settings.nearExpiryDays,
      due: due.map((r) => ({
        itemId: r.itemId,
        warehouseId: r.warehouseId,
        batchNo: r.batchNo,
        expiryDate: r.expiryDate,
        daysToExpiry: r.daysToExpiry,
        status: r.status,
        qty: r.qty.toString(),
        value: r.value.toString(),
      })),
      log: withinScope(log, scope, (a) => a.warehouseId),
    });
  });

  app.post("/scan", gate(EXPIRY_VIEW_PERMISSION), async (c) => c.json({ scannedAt: now(), emitted: await deps.scan() }));

  app.get("/write-off-proposal", gate("inventory.adjustment.create"), async (c) => {
    const warehouseId = c.req.query("warehouseId") ?? "";
    if (warehouseId === "") {
      return c.json({ error: "VALIDATION_ERROR", message: "اختر المستودع.", messageEn: "Pick a warehouse." }, 400);
    }
    const refusal = outOfScope(c, warehouseId);
    if (refusal) return refusal;
    const asOf = today();
    const lines = expiredWriteOffLines({ layers: await loadAllCostLayers(deps), warehouseId, asOf });
    return c.json({
      warehouseId,
      asOf,
      lines: lines.map(serializeWriteOffLine),
      totalValue: Money.sum(lines.map((l) => l.value)).toString(),
    });
  });

  app.post("/write-off", gate("inventory.adjustment.create"), async (c) => {
    const parsed = expiryWriteOffRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const refusal = outOfScope(c, parsed.data.warehouseId);
    if (refusal) return refusal;
    const asOf = today();
    const lines = expiredWriteOffLines({
      layers: await loadAllCostLayers(deps),
      warehouseId: parsed.data.warehouseId,
      asOf,
      itemIds: parsed.data.itemIds ? new Set(parsed.data.itemIds) : undefined,
    });
    if (lines.length === 0) {
      return c.json(
        {
          error: "NO_EXPIRED_STOCK",
          message: "لا توجد تشغيلات منتهية الصلاحية في هذا المستودع لشطبها.",
          messageEn: "There is no expired stock in this warehouse to write off.",
        },
        422,
      );
    }
    const adjustmentId = randomUUID();
    const itemNames = new Map((await deps.items.list()).map((i) => [i.id, i.nameAr]));
    const trace = lines
      .flatMap((l) => l.batches.map((b) => `${itemNames.get(l.itemId) ?? l.itemId} / ${b.batchNo ?? "—"} / ${b.expiryDate} / ${b.qty.toString()}`))
      .join("؛ ");
    const memo = [parsed.data.memo?.trim(), `شطب منتهي الصلاحية حتى ${asOf}: ${trace}`].filter(Boolean).join(" — ").slice(0, 2000);
    const response = await deps.forward("/inventory/stock-adjustments/draft", {
      method: "POST",
      headers: forwardedHeaders(c),
      body: JSON.stringify({
        id: adjustmentId,
        date: asOf,
        memo,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: parsed.data.warehouseId,
          reason: "EXPIRY",
          direction: "OUT",
          qty: l.qty.toString(),
        })),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { docNo?: string | null; status?: string };
    if (!response.ok) return c.json(body, response.status as 400);
    return c.json(
      {
        adjustmentId,
        docNo: body.docNo ?? null,
        status: body.status ?? "draft",
        lines: lines.map(serializeWriteOffLine),
      },
      201,
    );
  });

  app.get("/batch-trail", gateAny("inventory.stock.view", "sales.invoice.view"), async (c) => {
    const sourceDocId = c.req.query("sourceDocId") ?? "";
    if (sourceDocId === "") {
      return c.json({ error: "VALIDATION_ERROR", message: "حدد المستند.", messageEn: "Name a source document." }, 400);
    }
    return c.json(withinScope(await deps.trail.listBySourceDoc(sourceDocId), warehouseScopeOf(c), (e) => e.warehouseId).map(serializeTrail));
  });

  app.get("/recall", gate("inventory.stock.view"), async (c) => {
    const batchNo = (c.req.query("batchNo") ?? "").trim();
    if (batchNo === "") {
      return c.json({ error: "VALIDATION_ERROR", message: "أدخل رقم التشغيلة.", messageEn: "Enter a batch number." }, 400);
    }
    const itemId = c.req.query("itemId") || undefined;
    return c.json(withinScope(await deps.trail.listByBatch(batchNo, itemId), warehouseScopeOf(c), (e) => e.warehouseId).map(serializeTrail));
  });

  return app;
}

export function createFefoPreviewRoutes(deps: Pick<ExpiryRoutesDeps, "layers" | "today">, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const today = () => (deps.today ? deps.today() : toTenantDay(new Date().toISOString()));
  app.get("/", gate("inventory.stock.view"), async (c) => {
    const parsed = fefoPreviewQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const refusal = outOfScope(c, parsed.data.warehouseId);
    if (refusal) return refusal;
    const preview = previewFefo({
      itemId: parsed.data.itemId,
      warehouseId: parsed.data.warehouseId,
      layers: await deps.layers.listByPosition(parsed.data.itemId, parsed.data.warehouseId),
      requested: parsed.data.qty ? Qty.fromMajor(parsed.data.qty) : null,
      asOf: parsed.data.date ?? today(),
    });
    return c.json({
      itemId: preview.itemId,
      warehouseId: preview.warehouseId,
      asOf: preview.asOf,
      requested: preview.requested.toString(),
      onHandInLayers: preview.onHandInLayers.toString(),
      covered: preview.covered.toString(),
      shortfall: preview.shortfall.toString(),
      blockedByExpired: preview.blockedByExpired,
      expiredQty: preview.expiredQty.toString(),
      slices: preview.slices.map((s) => ({
        layerId: s.layerId,
        batchNo: s.batchNo,
        expiryDate: s.expiryDate,
        daysToExpiry: s.daysToExpiry,
        expired: s.expired,
        available: s.available.toString(),
        take: s.take.toString(),
      })),
    });
  });
  return app;
}

export function createBatchesReportRoutes(
  deps: Pick<ExpiryRoutesDeps, "items" | "warehouses" | "layers" | "stockLedger" | "store" | "scan" | "today">,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const today = () => (deps.today ? deps.today() : toTenantDay(new Date().toISOString()));
  app.get("/", gate("inventory.stock.view"), async (c) => {
    await deps.scan();
    const settings = await deps.store.getSettings();
    const definition = createInventoryBatchesReport(today(), settings.nearExpiryDays);
    const [items, warehouses, allLayers] = await Promise.all([deps.items.list(), deps.warehouses.findAll(), loadAllCostLayers(deps)]);
    const layers = withinScope(allLayers, warehouseScopeOf(c), (l) => l.warehouseId);
    const outcome = runReport(definition, { ...definition.defaultParams, ...c.req.query() }, { items, warehouses, layers });
    if (!outcome.ok) return c.json({ error: "VALIDATION_ERROR", errors: outcome.errors }, 400);
    return c.json({
      params: outcome.params,
      rows: outcome.rows,
      groups: outcome.groups,
      grandTotals: outcome.grandTotals,
      reconciliation: outcome.reconciliation,
      kpis: outcome.kpis,
      nearExpiryDays: settings.nearExpiryDays,
    });
  });
  return app;
}
