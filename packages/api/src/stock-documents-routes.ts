import { noteReversalOriginalDay } from "./posting-refusal.js";
import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  type DocumentStatus,
  DocumentNotFoundError,
  InvalidDocumentError,
  InvalidDocumentTransitionError,
  NegativeStockError,
  UncostedDeficitIssueError,
  InvalidStockMovementError,
  SameWarehouseTransferError,
  PhysicalCountNotFoundError,
  InvalidPhysicalCountError,
  InvalidPhysicalCountStatusError,
  revealsSystemQty,
  varianceLinesOf,
  summarizePhysicalCountVariance,
  type DocumentService,
  type FrameworkDocument,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
  type PhysicalCountService,
  type PhysicalCount,
  type PhysicalCountStatus,
  PHYSICAL_COUNT_STATUSES,
  matchesSearch,
} from "@mezan/domain";
import {
  ReversalPermission,
  createStockAdjustmentSchema,
  createStockTransferSchema,
  startPhysicalCountSchema,
  recordPhysicalCountEntriesSchema,
  generateAdjustmentFromCountSchema,
} from "@mezan/contracts";
import type { DocumentApprovalDTO } from "@mezan/contracts";
import { callerRoleCodes, callerUserId, createPermissionGate, sessionWarehouseScopeOf, warehouseScopeOf, withinScope, type AuthContextResolver } from "./permission-gate.js";
import { branchesOfWarehouses, storedBranchesById, withinBranchGrant } from "./stored-branches.js";
import { approvalOf, approvalReader, mountResubmitRoute } from "./document-resubmit.js";
import { readReversalRequest, requireReversalReason, reversalRefusalResponse } from "./document-reversal.js";
import { tenantDay } from "./tenant-day.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";
import { handleDocumentError as handleFrameworkDocumentError } from "./document-error-handling.js";

/**
 * Document-layer routes for the phase4/inventory-ops document types, built on
 * `DocumentService`/`PhysicalCountService` (@mezan/domain) — the draft → confirm
 * CRUD sitting ABOVE the raw engine primitives already mounted at
 * `/inventory/adjustments` and `/inventory/transfers` (inventory-routes.ts).
 * Mounted at distinct paths (`/inventory/stock-adjustments`,
 * `/inventory/stock-transfers`, `/inventory/physical-counts`) so the two
 * layers never collide.
 */

function serializeAdjustment(doc: FrameworkDocument<StockAdjustmentDocLine>, approval: DocumentApprovalDTO | null = null) {
  return {
    approval,
    workflowRequestId: doc.workflowRequestId,
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      reason: l.reason,
      direction: l.direction,
      qty: l.qty.toString(),
      unitCost: l.unitCost ? l.unitCost.toString() : null,
    })),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    journalEntryId: doc.journalEntryId,
    reversesDocId: doc.reversesDocId,
    reversedByDocId: doc.reversedByDocId,
    // One project/category per adjustment — carried per-line and validated
    // uniform (stock-adjustment-document.ts), surfaced here as a single header.
    projectId: doc.lines[0]?.projectId ?? null,
    costCategory: doc.lines[0]?.costCategory ?? null,
  };
}

function serializeTransfer(doc: FrameworkDocument<StockTransferDocLine>, approval: DocumentApprovalDTO | null = null) {
  return {
    approval,
    workflowRequestId: doc.workflowRequestId,
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map((l) => ({
      itemId: l.itemId,
      fromWarehouseId: l.fromWarehouseId,
      toWarehouseId: l.toWarehouseId,
      qty: l.qty.toString(),
    })),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
  };
}

/**
 * A blind count (جرد أعمى) withholds the system snapshot — and therefore every
 * variance figure derived from it — from the READ side until the session is
 * closed. Suppressing it here rather than in the web client is the point: the
 * counter must not be able to read it off the wire.
 */
function serializeCount(count: PhysicalCount) {
  const reveal = revealsSystemQty(count);
  const summary = reveal ? summarizePhysicalCountVariance(count) : null;
  return {
    id: count.id,
    countNo: count.countNo,
    warehouseId: count.warehouseId,
    date: count.date,
    memo: count.memo,
    status: count.status,
    blind: count.blind,
    lines: varianceLinesOf(count).map((l) => ({
      itemId: l.itemId,
      systemQty: reveal ? l.systemQty.toString() : null,
      unitCost: reveal ? l.unitCost.toString() : null,
      countedQty: l.countedQty ? l.countedQty.toString() : null,
      varianceQty: reveal && l.varianceQty ? l.varianceQty.toString() : null,
      varianceValue: reveal && l.varianceValue ? l.varianceValue.toString() : null,
    })),
    variance: summary
      ? {
          totalLines: summary.totalLines,
          countedLines: summary.countedLines,
          uncountedLines: summary.uncountedLines,
          matchedLines: summary.matchedLines,
          overLines: summary.overLines,
          shortLines: summary.shortLines,
          overQty: summary.overQty.toString(),
          shortQty: summary.shortQty.toString(),
          netQty: summary.netQty.toString(),
          overValue: summary.overValue.toString(),
          shortValue: summary.shortValue.toString(),
          netValue: summary.netValue.toString(),
          absValue: summary.absValue.toString(),
        }
      : null,
    createdAt: count.createdAt,
    completedAt: count.completedAt,
    generatedAdjustmentId: count.generatedAdjustmentId,
  };
}

/**
 * Every stored lifecycle status gets a count key, including the ones the
 * screen's chip row does not currently show: a chip that only appears once a
 * status has been used cannot be used to find that it has none.
 */
const DOCUMENT_STATUS_KEYS: readonly DocumentStatus[] = [
  "draft",
  "pending",
  "confirmed",
  "posted",
  "cancelled",
  "reversed",
];

/** The shared shape of the adjustments/transfers list filter. */
interface StockDocListFilter {
  readonly status?: string;
  readonly warehouseId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly search?: string;
}

function parseStockDocQuery(c: Context): StockDocListFilter {
  return {
    status: c.req.query("status") || undefined,
    warehouseId: c.req.query("warehouseId") || undefined,
    fromDate: c.req.query("fromDate") || undefined,
    toDate: c.req.query("toDate") || undefined,
    search: c.req.query("search") || undefined,
  };
}

/** The chip key `all` is not a stored status — forwarding it would match nothing. */
function storedStatus(status: string | undefined): DocumentStatus | undefined {
  return status && status !== "all" ? (status as DocumentStatus) : undefined;
}

/**
 * The write-side counterpart of `warehouseScopeOf` (D103): the list routes
 * narrowed by scope while every draft and confirm ignored it, so a caller
 * scoped to one warehouse could post stock into another and move goods out of a
 * warehouse they cannot even list. Returns the 403 to send, or `undefined` when
 * every named warehouse is inside scope — an unscoped caller passes everything.
 */
function warehouseScopeRefusal(c: Context, warehouseIds: readonly string[]): Response | undefined {
  const scope = sessionWarehouseScopeOf(c);
  if (!scope) return undefined;
  const offending = warehouseIds.find((id) => !scope.includes(id));
  if (offending === undefined) return undefined;
  return c.json(
    {
      error: "WAREHOUSE_OUT_OF_SCOPE",
      warehouseId: offending,
      message: `المستودع "${offending}" خارج نطاق المستودعات المصرّح لك بها.`,
    },
    403,
  );
}

function handleDocumentError(c: Context, err: unknown): Response {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = reversalRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof DocumentNotFoundError || err instanceof PhysicalCountNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidDocumentTransitionError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof InvalidPhysicalCountStatusError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof InvalidDocumentError ||
    err instanceof InvalidPhysicalCountError ||
    err instanceof InvalidStockMovementError
  ) {
    return c.json({ error: err.code, message: err.message }, 400);
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
  if (err instanceof SameWarehouseTransferError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  return handleFrameworkDocumentError(c, err);
}

/** `/inventory/stock-adjustments` — draft/confirm CRUD over `stockAdjustmentDocumentType`. */
export function createStockAdjustmentsRoutes(
  service: DocumentService<StockAdjustmentDocLine>,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext, {
    storedBranches: storedBranchesById(
      (id) => service.findById(id),
      (doc, c) => branchesOfWarehouses(c, doc.lines.map((line) => line.warehouseId)),
    ),
  });

  app.post("/draft", gate("inventory.adjustment.create"), async (c) => {
    const parsed = createStockAdjustmentSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const refusal = warehouseScopeRefusal(c, parsed.data.lines.map((l) => l.warehouseId));
    if (refusal) return refusal;
    try {
      const doc = await service.createDraft({
        id: parsed.data.id,
        date: await tenantDay(c, parsed.data.date),
        memo: parsed.data.memo ?? "",
        lines: parsed.data.lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          reason: l.reason,
          direction: l.direction,
          qty: Qty.fromMajor(l.qty),
          unitCost: l.unitCost ? Money.fromMajor(l.unitCost) : undefined,
          projectId: parsed.data.projectId ?? null,
          costCategory: parsed.data.costCategory ?? null,
        })),
      });
      return c.json(serializeAdjustment(doc), 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/confirm", gate("inventory.adjustment.confirm"), async (c) => {
    try {
      // Checked against the STORED lines, not the draft request: a wider-scoped
      // colleague may have drafted this, and the confirm is where stock moves.
      const existing = await service.findById(c.req.param("id"));
      if (existing) {
        const refusal = warehouseScopeRefusal(c, existing.lines.map((l) => l.warehouseId));
        if (refusal) return refusal;
      }
      const { document, held } = await service.confirm(c.req.param("id"), { actor: callerUserId(c), actorRoles: callerRoleCodes(c) });
      return c.json({ document: serializeAdjustment(document, await approvalOf(service, document)), held });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  mountResubmitRoute(app, {
    permission: gate("inventory.adjustment.confirm"),
    refuse: async (c, id) => {
      const doc = await service.findById(id);
      return doc ? warehouseScopeRefusal(c, doc.lines.map((l) => l.warehouseId)) : undefined;
    },
    resubmit: (c, id) => service.resubmit(id, { actor: callerUserId(c), actorRoles: callerRoleCodes(c) }),
    serialize: async (_c, doc) => serializeAdjustment(doc, await approvalOf(service, doc)),
    onError: handleDocumentError,
  });

  app.post("/:id/reverse", gate(ReversalPermission.StockAdjustment), requireReversalReason, async (c) => {
    try {
      const id = c.req.param("id");
      const existing = await service.findById(id);
      if (existing) {
        const refusal = warehouseScopeRefusal(c, existing.lines.map((l) => l.warehouseId));
        if (refusal) return refusal;
      }
      const { date, memo } = await readReversalRequest(c);
      await noteReversalOriginalDay(c, existing?.date);
      const { original, reversal } = await service.reverse(id, { reversalId: `${id}:REVERSAL`, date, memo, reason: memo, actor: callerUserId(c) });
      return c.json({ original: serializeAdjustment(original), reversal: serializeAdjustment(reversal) }, 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  interface AdjustmentListFilter extends StockDocListFilter {
    readonly reason?: string;
  }

  function parseAdjustmentQuery(c: Context): AdjustmentListFilter {
    return { ...parseStockDocQuery(c), reason: c.req.query("reason") || undefined };
  }

  /**
   * The one filter the rows, the chip counts and the KPI strip all go through
   * (R1.1). Nothing else selects adjustment rows, so the three routes below
   * cannot disagree about what the list holds.
   */
  async function listFilteredAdjustments(
    c: Context,
    filter: AdjustmentListFilter,
  ): Promise<readonly FrameworkDocument<StockAdjustmentDocLine>[]> {
    const docs = await service.list({
      status: storedStatus(filter.status),
      fromDate: filter.fromDate,
      toDate: filter.toDate,
    });
    // The warehouse is on the LINES, not the header, so a document is in scope
    // when any of its lines is. These are the routes the adjustments and
    // transfers screens actually call — the raw-engine routes were scoped
    // first and these were missed, so the selector still did nothing here.
    const scope = warehouseScopeOf(c);
    let visible = await withinBranchGrant(
      c,
      !scope ? docs : docs.filter((d) => d.lines.some((l) => scope.includes(l.warehouseId))),
      (d) => branchesOfWarehouses(c, d.lines.map((l) => l.warehouseId)),
    );

    // The reason lives on the lines too, and every line of one adjustment
    // carries the same one — the reason is picked before the form opens
    // (R5.9).
    if (filter.reason) visible = visible.filter((d) => d.lines.some((l) => l.reason === filter.reason));
    if (filter.warehouseId) visible = visible.filter((d) => d.lines.some((l) => l.warehouseId === filter.warehouseId));
    if (filter.search) visible = visible.filter((d) => matchesSearch(filter.search, d.docNo, d.memo));

    return visible;
  }

  app.get("/", gate("inventory.adjustment.view"), async (c) => {
    const docs = await listFilteredAdjustments(c, parseAdjustmentQuery(c));
    const approval = await approvalReader(service, docs);
    return c.json(docs.map((doc) => serializeAdjustment(doc, approval(doc))));
  });

  /**
   * The status chips. Deliberately drops its own `status` axis: a chip states
   * how many rows it WOULD show, so counting the already status-filtered set
   * renders every chip but the active one as zero. The warehouse, reason, date
   * and search filters still apply — and so does the warehouse SCOPE, which no
   * query parameter can widen.
   */
  app.get("/counts", gate("inventory.adjustment.view"), async (c) => {
    const { status: _ignored, ...withoutStatus } = parseAdjustmentQuery(c);
    const docs = await listFilteredAdjustments(c, withoutStatus);
    const counts: Record<string, number> = { all: docs.length };
    for (const status of DOCUMENT_STATUS_KEYS) counts[status] = 0;
    for (const doc of docs) counts[doc.status] = (counts[doc.status] ?? 0) + 1;
    return c.json(counts);
  });

  /** The KPI strip. Unlike `/counts` this DOES honour the status filter. */
  app.get("/stats", gate("inventory.adjustment.view"), async (c) => {
    const docs = await listFilteredAdjustments(c, parseAdjustmentQuery(c));
    return c.json({
      count: docs.length,
      draft: docs.filter((d) => d.status === "draft").length,
      confirmed: docs.filter((d) => d.status === "confirmed").length,
    });
  });

  app.get("/:id", gate("inventory.adjustment.view"), async (c) => {
    const doc = await service.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "DOCUMENT_NOT_FOUND" }, 404);
    return c.json(serializeAdjustment(doc, await approvalOf(service, doc)));
  });

  return app;
}

/** `/inventory/stock-transfers` — draft/confirm CRUD over `stockTransferDocumentType`. */
export function createStockTransfersRoutes(
  service: DocumentService<StockTransferDocLine>,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  /**
   * SECURITY: a write is judged by the warehouses stock LEAVES — sending to
   * another branch is a branch user's own act, drawing from one is not. A read
   * sees both ends, as the list does.
   */
  const gate = createPermissionGate(resolveAuthContext, {
    storedBranches: storedBranchesById(
      (id) => service.findById(id),
      (doc, c) =>
        branchesOfWarehouses(
          c,
          doc.lines.flatMap((line) =>
            c.req.method === "GET" || c.req.method === "HEAD" ? [line.fromWarehouseId, line.toWarehouseId] : [line.fromWarehouseId],
          ),
        ),
    ),
  });

  app.post("/draft", gate("inventory.transfer.create"), async (c) => {
    const parsed = createStockTransferSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    // BOTH ends: shipping out of a warehouse the caller cannot see is the theft
    // path, and shipping INTO one removes the goods from their view.
    const refusal = warehouseScopeRefusal(
      c,
      parsed.data.lines.flatMap((l) => [l.fromWarehouseId, l.toWarehouseId]),
    );
    if (refusal) return refusal;
    try {
      const doc = await service.createDraft({
        id: parsed.data.id,
        date: await tenantDay(c, parsed.data.date),
        memo: parsed.data.memo ?? "",
        lines: parsed.data.lines.map((l) => ({
          itemId: l.itemId,
          fromWarehouseId: l.fromWarehouseId,
          toWarehouseId: l.toWarehouseId,
          qty: Qty.fromMajor(l.qty),
        })),
      });
      return c.json(serializeTransfer(doc), 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/confirm", gate("inventory.transfer.confirm"), async (c) => {
    try {
      // Checked against the STORED lines, not the draft request: a wider-scoped
      // colleague may have drafted this, and the confirm is where stock moves.
      const existing = await service.findById(c.req.param("id"));
      if (existing) {
        const refusal = warehouseScopeRefusal(
          c,
          existing.lines.flatMap((l) => [l.fromWarehouseId, l.toWarehouseId]),
        );
        if (refusal) return refusal;
      }
      const { document, held } = await service.confirm(c.req.param("id"), { actor: callerUserId(c), actorRoles: callerRoleCodes(c) });
      return c.json({ document: serializeTransfer(document, await approvalOf(service, document)), held });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  mountResubmitRoute(app, {
    permission: gate("inventory.transfer.confirm"),
    refuse: async (c, id) => {
      const doc = await service.findById(id);
      return doc ? warehouseScopeRefusal(c, doc.lines.flatMap((l) => [l.fromWarehouseId, l.toWarehouseId])) : undefined;
    },
    resubmit: (c, id) => service.resubmit(id, { actor: callerUserId(c), actorRoles: callerRoleCodes(c) }),
    serialize: async (_c, doc) => serializeTransfer(doc, await approvalOf(service, doc)),
    onError: handleDocumentError,
  });

  /**
   * The one filter the rows, the chip counts and the KPI strip all go through
   * (R1.1). A transfer has two warehouses, and BOTH the scope and the
   * `warehouseId` filter match on either end — hiding a transfer from the
   * receiving warehouse would make its stock appear from nowhere.
   */
  async function listFilteredTransfers(
    c: Context,
    filter: StockDocListFilter,
  ): Promise<readonly FrameworkDocument<StockTransferDocLine>[]> {
    const docs = await service.list({
      status: storedStatus(filter.status),
      fromDate: filter.fromDate,
      toDate: filter.toDate,
    });
    const scope = warehouseScopeOf(c);
    let visible = await withinBranchGrant(
      c,
      !scope ? docs : docs.filter((d) => d.lines.some((l) => scope.includes(l.fromWarehouseId) || scope.includes(l.toWarehouseId))),
      (d) => branchesOfWarehouses(c, d.lines.flatMap((l) => [l.fromWarehouseId, l.toWarehouseId])),
    );
    if (filter.warehouseId) {
      visible = visible.filter((d) =>
        d.lines.some((l) => l.fromWarehouseId === filter.warehouseId || l.toWarehouseId === filter.warehouseId),
      );
    }
    if (filter.search) visible = visible.filter((d) => matchesSearch(filter.search, d.docNo, d.memo));
    return visible;
  }

  app.get("/", gate("inventory.transfer.view"), async (c) => {
    const docs = await listFilteredTransfers(c, parseStockDocQuery(c));
    const approval = await approvalReader(service, docs);
    return c.json(docs.map((doc) => serializeTransfer(doc, approval(doc))));
  });

  /**
   * The status chips. Deliberately drops its own `status` axis: a chip states
   * how many rows it WOULD show, so counting the already status-filtered set
   * renders every chip but the active one as zero.
   */
  app.get("/counts", gate("inventory.transfer.view"), async (c) => {
    const { status: _ignored, ...withoutStatus } = parseStockDocQuery(c);
    const docs = await listFilteredTransfers(c, withoutStatus);
    const counts: Record<string, number> = { all: docs.length };
    for (const status of DOCUMENT_STATUS_KEYS) counts[status] = 0;
    for (const doc of docs) counts[doc.status] = (counts[doc.status] ?? 0) + 1;
    return c.json(counts);
  });

  /** The KPI strip. Unlike `/counts` this DOES honour the status filter. */
  app.get("/stats", gate("inventory.transfer.view"), async (c) => {
    const docs = await listFilteredTransfers(c, parseStockDocQuery(c));
    return c.json({
      count: docs.length,
      draft: docs.filter((d) => d.status === "draft").length,
      confirmed: docs.filter((d) => d.status === "confirmed").length,
    });
  });

  app.get("/:id", gate("inventory.transfer.view"), async (c) => {
    const doc = await service.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "DOCUMENT_NOT_FOUND" }, 404);
    return c.json(serializeTransfer(doc, await approvalOf(service, doc)));
  });

  return app;
}

/** `/inventory/physical-counts` — start → record counts → complete → generate adjustment. */
export function createPhysicalCountsRoutes(
  service: PhysicalCountService,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext, {
    storedBranches: storedBranchesById((id) => service.findById(id), (count, c) => branchesOfWarehouses(c, [count.warehouseId])),
  });

  app.post("/", gate("inventory.count.create"), async (c) => {
    const parsed = startPhysicalCountSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const refusal = warehouseScopeRefusal(c, [parsed.data.warehouseId]);
    if (refusal) return refusal;
    try {
      const count = await service.start(parsed.data);
      return c.json(serializeCount(count), 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  async function refuseCountOutOfScope(c: Context, id: string): Promise<Response | undefined> {
    const existing = await service.findById(id);
    return existing ? warehouseScopeRefusal(c, [existing.warehouseId]) : undefined;
  }

  app.post("/:id/counts", gate("inventory.count.create"), async (c) => {
    const parsed = recordPhysicalCountEntriesSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const refusal = await refuseCountOutOfScope(c, c.req.param("id"));
    if (refusal) return refusal;
    try {
      const count = await service.recordCounts(
        c.req.param("id"),
        parsed.data.entries.map((e) => ({ itemId: e.itemId, countedQty: Qty.fromMajor(e.countedQty) })),
      );
      return c.json(serializeCount(count));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/complete", gate("inventory.count.create"), async (c) => {
    const refusal = await refuseCountOutOfScope(c, c.req.param("id"));
    if (refusal) return refusal;
    try {
      const count = await service.complete(c.req.param("id"));
      return c.json(serializeCount(count));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/cancel", gate("inventory.count.create"), async (c) => {
    const refusal = await refuseCountOutOfScope(c, c.req.param("id"));
    if (refusal) return refusal;
    try {
      const count = await service.cancel(c.req.param("id"));
      return c.json(serializeCount(count));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/generate-adjustment", gate("inventory.count.confirm"), async (c) => {
    const parsed = generateAdjustmentFromCountSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    // This one posts a CONFIRMED adjustment: it is where the count's variance
    // actually moves stock, so it carries the same scope check the adjustment
    // and transfer writes do (D103).
    const refusal = await refuseCountOutOfScope(c, c.req.param("id"));
    if (refusal) return refusal;
    try {
      const result = await service.generateAdjustment({
        countId: c.req.param("id"),
        adjustmentId: parsed.data.adjustmentId,
        actor: callerUserId(c),
      });
      return c.json({
        count: serializeCount(result.count),
        adjustment: result.adjustment ? serializeAdjustment(result.adjustment) : null,
      });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  interface CountListFilter {
    readonly status?: string;
    readonly warehouseId?: string;
    readonly search?: string;
  }

  function parseCountListQuery(c: Context): CountListFilter {
    return {
      status: c.req.query("status") || undefined,
      warehouseId: c.req.query("warehouseId") || undefined,
      search: c.req.query("search") || undefined,
    };
  }

  /**
   * The one filter the rows, the chip counts and the KPI strip all go through
   * (R1.1). `warehouseScopeOf` decides what this user may see at all; the
   * `warehouseId` parameter only narrows the already-scoped set.
   */
  async function listFilteredCounts(c: Context, filter: CountListFilter): Promise<readonly PhysicalCount[]> {
    const status = filter.status && filter.status !== "all" ? (filter.status as PhysicalCountStatus) : undefined;
    const rows = await withinBranchGrant(
      c,
      withinScope(await service.list({ status, warehouseId: filter.warehouseId }), warehouseScopeOf(c), (count) => count.warehouseId),
      (count) => branchesOfWarehouses(c, [count.warehouseId]),
    );
    if (!filter.search) return rows;
    return rows.filter((count) => matchesSearch(filter.search, count.countNo, count.memo));
  }

  app.get("/", gate("inventory.count.view"), async (c) => {
    const rows = await listFilteredCounts(c, parseCountListQuery(c));
    return c.json(rows.map(serializeCount));
  });

  /**
   * The status chips. Deliberately drops its own `status` axis: a chip states
   * how many rows it WOULD show, so counting the already status-filtered set
   * renders every chip but the active one as zero.
   */
  app.get("/counts", gate("inventory.count.view"), async (c) => {
    const { status: _ignored, ...withoutStatus } = parseCountListQuery(c);
    const rows = await listFilteredCounts(c, withoutStatus);
    const counts: Record<string, number> = { all: rows.length };
    for (const status of PHYSICAL_COUNT_STATUSES) counts[status] = 0;
    for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return c.json(counts);
  });

  /** The KPI strip. Unlike `/counts` this DOES honour the status filter. */
  app.get("/stats", gate("inventory.count.view"), async (c) => {
    const rows = await listFilteredCounts(c, parseCountListQuery(c));
    return c.json({
      count: rows.length,
      IN_PROGRESS: rows.filter((r) => r.status === "IN_PROGRESS").length,
      COMPLETED: rows.filter((r) => r.status === "COMPLETED").length,
      ADJUSTMENT_GENERATED: rows.filter((r) => r.status === "ADJUSTMENT_GENERATED").length,
    });
  });

  app.get("/:id", gate("inventory.count.view"), async (c) => {
    const count = await service.findById(c.req.param("id"));
    if (!count) return c.json({ error: "PHYSICAL_COUNT_NOT_FOUND" }, 404);
    return c.json(serializeCount(count));
  });

  return app;
}
