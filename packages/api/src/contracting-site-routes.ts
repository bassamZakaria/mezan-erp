import { readReversalRequest, reversalRefusalResponse, requireReversalReason } from "./document-reversal.js";
import { noteReversalOriginalDay } from "./posting-refusal.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  ExpiredStockError,
  InvalidSiteDocumentError,
  InvalidStockMovementError,
  Money,
  NegativeStockError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  ProjectNotFoundError,
  Qty,
  SameWarehouseTransferError,
  SiteDocumentNotFoundError,
  SiteDocumentStatusError,
  SiteReceiptSelfReceiptError,
  UncostedDeficitIssueError,
  type ConsumptionByBoqLineRow,
  type CustodyItem,
  type EquipmentHoursRow,
  type EquipmentLog,
  type MaterialConsumption,
  type SiteIssue,
  type SiteIssueStatus,
  type SiteReceipt,
  type SiteService,
  type UnreceivedRow,
} from "@mezan/domain";
import {
  ReversalPermission,
  createEquipmentLogSchema,
  createMaterialConsumptionSchema,
  createSiteIssueSchema,
  createSiteReceiptSchema,
  issueCustodySchema,
  returnCustodySchema,
} from "@mezan/contracts";
import { callerUserId, createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * مستودعات المواقع والصرف والاستهلاك — slice 4A's routes, mounted under
 * `/contracting/site` (docs/artifacts/mezan-contracting-designs.html D-11).
 *
 * PERMISSIONS. Issues and receipts move stock between warehouses, so they reuse
 * `inventory.transfer.*`; consumption relieves stock and posts, so it reuses
 * `inventory.adjustment.*`. The custody register and plant-hour logs are
 * project records rather than stock ones and use `projects.project.*`. No new
 * permission code is minted for any of them.
 */

function serializeIssue(issue: SiteIssue) {
  return {
    id: issue.id,
    docNo: issue.docNo,
    date: issue.date,
    fromWarehouseId: issue.fromWarehouseId,
    toWarehouseId: issue.toWarehouseId,
    projectId: issue.projectId,
    issuedByUserId: issue.issuedByUserId,
    transitWarehouseId: issue.transitWarehouseId,
    notes: issue.notes,
    status: issue.status,
    lines: issue.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() })),
    createdAt: issue.createdAt,
    issuedAt: issue.issuedAt,
  };
}

function serializeReceipt(receipt: SiteReceipt) {
  return {
    id: receipt.id,
    docNo: receipt.docNo,
    issueId: receipt.issueId,
    date: receipt.date,
    receivedByUserId: receipt.receivedByUserId,
    projectId: receipt.projectId,
    notes: receipt.notes,
    status: receipt.status,
    lines: receipt.lines.map((l) => ({ itemId: l.itemId, qtyReceived: l.qtyReceived.toString() })),
    createdAt: receipt.createdAt,
    confirmedAt: receipt.confirmedAt,
  };
}

function serializeConsumption(consumption: MaterialConsumption) {
  return {
    id: consumption.id,
    docNo: consumption.docNo,
    date: consumption.date,
    warehouseId: consumption.warehouseId,
    projectId: consumption.projectId,
    boqLineId: consumption.boqLineId,
    subcontractId: consumption.subcontractId,
    notes: consumption.notes,
    status: consumption.status,
    lines: consumption.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() })),
    totalCost: consumption.totalCost.toString(),
    journalEntryId: consumption.journalEntryId,
    createdAt: consumption.createdAt,
    confirmedAt: consumption.confirmedAt,
  };
}

function serializeCustody(item: CustodyItem) {
  return {
    id: item.id,
    projectId: item.projectId,
    warehouseId: item.warehouseId,
    custodianUserId: item.custodianUserId,
    descriptionAr: item.descriptionAr,
    qtyOut: item.qtyOut.toString(),
    qtyReturned: item.qtyReturned.toString(),
    issuedDate: item.issuedDate,
    expectedReturnDate: item.expectedReturnDate,
    notes: item.notes,
  };
}

function serializeEquipmentLog(log: EquipmentLog) {
  return {
    id: log.id,
    docNo: log.docNo,
    projectId: log.projectId,
    assetId: log.assetId,
    date: log.date,
    hours: log.hours.toString(),
    hourlyRate: log.hourlyRate.toString(),
    amount: log.amount.toString(),
    boqLineId: log.boqLineId,
    notes: log.notes,
    status: log.status,
    journalEntryId: log.journalEntryId,
    createdAt: log.createdAt,
    confirmedAt: log.confirmedAt,
  };
}

function serializeUnreceived(row: UnreceivedRow) {
  return {
    issueId: row.issueId,
    docNo: row.docNo,
    date: row.date,
    projectId: row.projectId,
    fromWarehouseId: row.fromWarehouseId,
    toWarehouseId: row.toWarehouseId,
    transitWarehouseId: row.transitWarehouseId,
    issuedByUserId: row.issuedByUserId,
    itemId: row.itemId,
    qtyIssued: row.qtyIssued.toString(),
    qtyReceived: row.qtyReceived.toString(),
    qtyOutstanding: row.qtyOutstanding.toString(),
    ageDays: row.ageDays,
    kind: row.kind,
    receiptId: row.receiptId,
    receiptDocNo: row.receiptDocNo,
    receiptDate: row.receiptDate,
  };
}

function serializeConsumptionByBoqLine(row: ConsumptionByBoqLineRow) {
  return { boqLineId: row.boqLineId, itemId: row.itemId, qty: row.qty.toString(), cost: row.cost.toString() };
}

function serializeEquipmentHours(row: EquipmentHoursRow) {
  return { boqLineId: row.boqLineId, hours: row.hours.toString(), amount: row.amount.toString() };
}

function handleDomainError(c: Context, err: unknown) {
  const postingRefusal = reversalRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof SiteDocumentStatusError && err.messageEn) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof SiteDocumentNotFoundError || err instanceof ProjectNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof SiteReceiptSelfReceiptError || err instanceof SiteDocumentStatusError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidSiteDocumentError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof NegativeStockError) {
    return c.json(
      { error: err.code, message: err.message, onHand: err.onHand.toString(), requested: err.requested.toString() },
      422,
    );
  }
  if (err instanceof UncostedDeficitIssueError) {
    return c.json({ error: err.code, message: err.message, requested: err.requested.toString() }, 422);
  }
  if (err instanceof ExpiredStockError) {
    return c.json({ error: err.code, message: err.message, batchNo: err.batchNo, expiryDate: err.expiryDate }, 422);
  }
  if (err instanceof SameWarehouseTransferError || err instanceof InvalidStockMovementError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  // A closed month is a refusal the storekeeper has to read, never a 500.
  if (err instanceof PeriodNotOpenForPostingError || err instanceof NoFiscalPeriodForDateError) {
    return c.json({ error: "FISCAL_PERIOD_CLOSED", message: err.message }, 409);
  }
  throw err;
}

/** A caller with no resolvable identity cannot sign for material; the two-step control is an identity check. */
const UNIDENTIFIED = {
  error: "UNIDENTIFIED_ACTOR",
  message: "تعذّر تحديد هوية المستخدم — سجّل الدخول من جديد.",
} as const;

export interface ContractingSiteRoutesDeps {
  readonly service: SiteService;
}

export function createContractingSiteRoutes(
  deps: ContractingSiteRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = deps.service;

  // --- أذونات الصرف للموقع ---

  app.get("/issues", gate("inventory.transfer.view"), async (c) => {
    const projectId = c.req.query("projectId");
    const status = c.req.query("status");
    const issues = await service.listIssues({
      ...(projectId ? { projectId } : {}),
      ...(status && status !== "all" ? { status: status as SiteIssueStatus } : {}),
    });
    return c.json(issues.map(serializeIssue));
  });

  app.get("/issues/:id", gate("inventory.transfer.view"), async (c) => {
    const issue = await service.getIssue(c.req.param("id"));
    if (!issue) return c.json({ error: "NOT_FOUND" }, 404);
    const outstanding = await service.outstandingOf(issue);
    return c.json({
      ...serializeIssue(issue),
      outstanding: [...outstanding.entries()].map(([itemId, qty]) => ({ itemId, qty: qty.toString() })),
    });
  });

  app.post("/issues", gate("inventory.transfer.create"), async (c) => {
    const parsed = createSiteIssueSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const userId = callerUserId(c);
    if (!userId) return c.json(UNIDENTIFIED, 403);
    try {
      const issue = await service.createIssueDraft({
        id: parsed.data.id,
        date: parsed.data.date,
        fromWarehouseId: parsed.data.fromWarehouseId,
        toWarehouseId: parsed.data.toWarehouseId,
        issuedByUserId: userId,
        notes: parsed.data.notes ?? null,
        lines: parsed.data.lines.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
      });
      return c.json(serializeIssue(issue), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/issues/:id/confirm", gate("inventory.transfer.confirm"), async (c) => {
    try {
      return c.json(serializeIssue(await service.confirmIssue(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- الاستلام بالموقع ---

  app.get("/receipts", gate("inventory.transfer.view"), async (c) => {
    const projectId = c.req.query("projectId");
    const issueId = c.req.query("issueId");
    const receipts = await service.listReceipts({
      ...(projectId ? { projectId } : {}),
      ...(issueId ? { issueId } : {}),
    });
    return c.json(receipts.map(serializeReceipt));
  });

  app.get("/receipts/:id", gate("inventory.transfer.view"), async (c) => {
    const receipt = await service.getReceipt(c.req.param("id"));
    if (!receipt) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeReceipt(receipt));
  });

  app.post("/receipts", gate("inventory.transfer.create"), async (c) => {
    const parsed = createSiteReceiptSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const userId = callerUserId(c);
    if (!userId) return c.json(UNIDENTIFIED, 403);
    try {
      const receipt = await service.createReceiptDraft({
        id: parsed.data.id,
        issueId: parsed.data.issueId,
        date: parsed.data.date,
        receivedByUserId: userId,
        notes: parsed.data.notes ?? null,
        lines: parsed.data.lines.map((l) => ({ itemId: l.itemId, qtyReceived: Qty.fromMajor(l.qtyReceived) })),
      });
      return c.json(serializeReceipt(receipt), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/receipts/:id/confirm", gate("inventory.transfer.confirm"), async (c) => {
    try {
      return c.json(serializeReceipt(await service.confirmReceipt(c.req.param("id"))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- استهلاك المواد ---

  app.get("/consumptions", gate("inventory.adjustment.view"), async (c) => {
    const projectId = c.req.query("projectId");
    const warehouseId = c.req.query("warehouseId");
    const subcontractId = c.req.query("subcontractId");
    const consumptions = await service.listConsumptions({
      ...(projectId ? { projectId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(subcontractId ? { subcontractId } : {}),
    });
    return c.json(consumptions.map(serializeConsumption));
  });

  app.get("/consumptions/:id", gate("inventory.adjustment.view"), async (c) => {
    const consumption = await service.getConsumption(c.req.param("id"));
    if (!consumption) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeConsumption(consumption));
  });

  app.post("/consumptions", gate("inventory.adjustment.create"), async (c) => {
    const parsed = createMaterialConsumptionSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const consumption = await service.createConsumptionDraft({
        id: parsed.data.id,
        date: parsed.data.date,
        warehouseId: parsed.data.warehouseId,
        boqLineId: parsed.data.boqLineId ?? null,
        subcontractId: parsed.data.subcontractId ?? null,
        notes: parsed.data.notes ?? null,
        lines: parsed.data.lines.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
      });
      return c.json(serializeConsumption(consumption), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/consumptions/:id/confirm", gate("inventory.adjustment.confirm"), async (c) => {
    try {
      return c.json(serializeConsumption(await service.confirmConsumption(c.req.param("id"), callerUserId(c))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- عهدة المواد ---

  app.post("/consumptions/:id/reverse", gate(ReversalPermission.MaterialConsumption), requireReversalReason, async (c) => {
    try {
      const { date, memo } = await readReversalRequest(c);
      await noteReversalOriginalDay(c, (await service.getConsumption(c.req.param("id")))?.date);
      const consumption = await service.reverseConsumption(c.req.param("id"), { reversalId: randomUUID(), date, memo, actor: callerUserId(c) ?? null });
      return c.json(serializeConsumption(consumption));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/custody", gate("projects.project.view"), async (c) => {
    const projectId = c.req.query("projectId");
    const warehouseId = c.req.query("warehouseId");
    const items = await service.listCustody({
      ...(projectId ? { projectId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(c.req.query("outstanding") === "1" ? { outstandingOnly: true } : {}),
    });
    return c.json(items.map(serializeCustody));
  });

  app.post("/custody", gate("projects.project.manage"), async (c) => {
    const parsed = issueCustodySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const item = await service.issueCustody({
        id: parsed.data.id,
        warehouseId: parsed.data.warehouseId,
        descriptionAr: parsed.data.descriptionAr,
        qtyOut: Qty.fromMajor(parsed.data.qtyOut),
        issuedDate: parsed.data.issuedDate,
        expectedReturnDate: parsed.data.expectedReturnDate ?? null,
        notes: parsed.data.notes ?? null,
      });
      return c.json(serializeCustody(item), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/custody/:id/return", gate("projects.project.manage"), async (c) => {
    const parsed = returnCustodySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const item = await service.returnCustody(c.req.param("id"), {
        qty: Qty.fromMajor(parsed.data.qty),
        date: parsed.data.date,
      });
      return c.json(serializeCustody(item));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- تشغيل المعدات ---

  app.get("/equipment-logs", gate("projects.project.view"), async (c) => {
    const projectId = c.req.query("projectId");
    const assetId = c.req.query("assetId");
    const logs = await service.listEquipmentLogs({
      ...(projectId ? { projectId } : {}),
      ...(assetId ? { assetId } : {}),
    });
    return c.json(logs.map(serializeEquipmentLog));
  });

  app.post("/equipment-logs", gate("projects.project.manage"), async (c) => {
    const parsed = createEquipmentLogSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const log = await service.createEquipmentLogDraft({
        id: parsed.data.id,
        projectId: parsed.data.projectId,
        assetId: parsed.data.assetId,
        date: parsed.data.date,
        hours: Qty.fromMajor(parsed.data.hours),
        boqLineId: parsed.data.boqLineId ?? null,
        notes: parsed.data.notes ?? null,
      });
      return c.json(serializeEquipmentLog(log), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/equipment-logs/:id/confirm", gate("projects.project.manage"), async (c) => {
    try {
      return c.json(serializeEquipmentLog(await service.confirmEquipmentLog(c.req.param("id"), callerUserId(c))));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // --- الاستثناءات والتجميعات ---

  app.post("/equipment-logs/:id/reverse", gate(ReversalPermission.EquipmentLog), requireReversalReason, async (c) => {
    try {
      const { date, memo } = await readReversalRequest(c);
      const log = await service.reverseEquipmentLog(c.req.param("id"), { reversalId: randomUUID(), date, memo, actor: callerUserId(c) ?? null });
      return c.json(serializeEquipmentLog(log));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/unreceived", gate("inventory.transfer.view"), async (c) => {
    const raw = Number(c.req.query("olderThanDays") ?? "0");
    const olderThanDays = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    const projectId = c.req.query("projectId");
    const rows = await service.listUnreceived({ olderThanDays, ...(projectId ? { projectId } : {}) });
    return c.json(rows.map(serializeUnreceived));
  });

  app.get("/consumption-by-boq-line", gate("projects.project.view"), async (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "VALIDATION_ERROR", message: "projectId مطلوب" }, 400);
    const rows = await service.consumptionByBoqLine(projectId);
    return c.json(rows.map(serializeConsumptionByBoqLine));
  });

  app.get("/equipment-hours", gate("projects.project.view"), async (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "VALIDATION_ERROR", message: "projectId مطلوب" }, 400);
    const rows = await service.equipmentHours(projectId);
    return c.json(rows.map(serializeEquipmentHours));
  });

  return app;
}
