import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  landedCostAbsorptionDate,
  Money,
  Qty,
  distributeLandedCost,
  EmptyLandedCostTargetsError,
  ZeroLandedCostWeightError,
  type DocumentService,
  type FrameworkDocument,
  type LandedCostLine,
  type LandedCostService,
  type WarehouseBranchLookup,
  branchOfPostingWarehouse,
} from "@mezan/domain";
import { ReversalPermission, clientSuppliedId, createLandedCostSchema } from "@mezan/contracts";
import { type AuthContextResolver, callerRoleCodes, callerUserId, createPermissionGate, withItemCost } from "./permission-gate.js";
import { documentBranches, storedBranchesById, withinBranchGrant } from "./stored-branches.js";
import { handleDocumentError } from "./document-error-handling.js";
import { refuseOutOfScopeBranches } from "./branch-scope-refusal.js";
import { approvalOf, approvalReader, mountResubmitRoute } from "./document-resubmit.js";
import type { DocumentApprovalDTO } from "@mezan/contracts";
import { noteReversalOriginalDay } from "./posting-refusal.js";
import { DOCUMENT_NOT_FOUND, MirrorAccess, anyLineInWarehouseScope, createVisibleDocumentResolver } from "./document-visibility.js";
import { tenantDay, tenantToday } from "./tenant-day.js";

function serializeLine(l: LandedCostLine) {
  return {
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    sourceInvoiceId: l.sourceInvoiceId,
    sourceInvoiceNumber: l.sourceInvoiceNumber,
    qty: l.qty.toString(),
    unitCost: l.unitCost.toString(),
    weight: l.weight.toString(),
    allocatedAmount: l.allocatedAmount.toString(),
    newUnitCost: l.newUnitCost.toString(),
    distributionMethod: l.distributionMethod,
    costItems: l.costItems.map((ci) => ({
      costType: ci.costType,
      description: ci.description,
      amount: ci.amount.toString(),
      supplierId: ci.supplierId ?? null,
    })),
    projectId: l.projectId ?? null,
    costCategory: l.costCategory ?? null,
  };
}

const LANDED_COST_ITEM_COST_KEYS = ["newUnitCost"] as const;

function serialize(c: Context, doc: FrameworkDocument<LandedCostLine>, approval: DocumentApprovalDTO | null = null) {
  return withItemCost(c, serializeDocument(doc, approval), LANDED_COST_ITEM_COST_KEYS);
}

function serializeDocument(doc: FrameworkDocument<LandedCostLine>, approval: DocumentApprovalDTO | null = null) {
  return {
    approval,
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    absorptionDate: doc.status === "draft" ? null : landedCostAbsorptionDate(doc),
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map(serializeLine),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    reversesDocId: doc.reversesDocId,
    reversedByDocId: doc.reversedByDocId,
    workflowRequestId: doc.workflowRequestId,
    journalEntryId: doc.journalEntryId,
  };
}

/**
 * Landed Costs routes (docs/archive/catalog/02 §"التكاليف الإضافية"), mounted under
 * `/landed-costs`. `documents` reads/creates/cancels via the plain
 * `DocumentService`; `landedCostService` (the same underlying document
 * service, wrapped) drives confirm so the cost-layer revaluation runs too
 * (see `landed-costs/service.ts`).
 */
export function createLandedCostsRoutes(
  documents: DocumentService<LandedCostLine>,
  landedCostService: LandedCostService,
  resolveAuthContext: AuthContextResolver,
  warehouses?: WarehouseBranchLookup,
) {
  const app = new Hono();
  const branchesOf = (c: Context, doc: { readonly lines: readonly LandedCostLine[] }) =>
    documentBranches(c, doc.lines.map((line) => line.branchId), doc.lines.map((line) => line.warehouseId));
  const gate = createPermissionGate(resolveAuthContext, {
    storedBranches: storedBranchesById((id) => documents.findById(id), (doc, c) => branchesOf(c, doc)),
  });
  const inScope = (c: Context, doc: FrameworkDocument<LandedCostLine>) => anyLineInWarehouseScope(c, doc.lines.map((line) => line.warehouseId));
  const visibleLandedCost = createVisibleDocumentResolver(documents, inScope);

  app.get("/", gate("purchases.landed_cost.view"), async (c) => {
    const status = c.req.query("status");
    const inWarehouseScope = (await documents.list({ status: status as never })).filter((doc) => inScope(c, doc));
    const list = await withinBranchGrant(c, inWarehouseScope, (doc) => branchesOf(c, doc));
    const approval = await approvalReader(documents, list);
    return c.json(list.map((doc) => serialize(c, doc, approval(doc))));
  });

  app.get("/:id", gate("purchases.landed_cost.view"), async (c) => {
    const doc = await visibleLandedCost(c, MirrorAccess.Reachable);
    if (!doc) return c.json(DOCUMENT_NOT_FOUND, 404);
    return c.json(serialize(c, doc, await approvalOf(documents, doc)));
  });

  app.post("/", gate("purchases.landed_cost.create"), async (c) => {
    const parsed = createLandedCostSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const costItems = parsed.data.costItems.map((ci) => ({
        costType: ci.costType,
        description: ci.description,
        amount: Money.fromMajor(ci.amount),
        supplierId: ci.supplierId ?? null,
      }));
      const branchByWarehouse = new Map<string, string | null>();
      for (const warehouseId of new Set(parsed.data.targets.map((t) => t.warehouseId))) {
        branchByWarehouse.set(warehouseId, await branchOfPostingWarehouse(warehouses, warehouseId));
      }
      const branchRefusal = refuseOutOfScopeBranches(c, [...branchByWarehouse.values()]);
      if (branchRefusal) return branchRefusal;
      const targets = parsed.data.targets.map((t) => ({
        branchId: branchByWarehouse.get(t.warehouseId) ?? null,
        itemId: t.itemId,
        warehouseId: t.warehouseId,
        sourceInvoiceId: t.sourceInvoiceId,
        sourceInvoiceNumber: t.sourceInvoiceNumber,
        qty: Qty.fromMajor(t.qty),
        unitCost: Money.fromMajor(t.unitCost),
        weight: Qty.fromMajor(t.weight),
        projectId: parsed.data.projectId ?? null,
        costCategory: t.costCategory ?? null,
      }));
      const allocated = distributeLandedCost(costItems, parsed.data.distributionMethod, targets);
      const lines: LandedCostLine[] = allocated.map((a) => ({
        ...a,
        costItems,
        distributionMethod: parsed.data.distributionMethod,
      }));
      const doc = await documents.createDraft({ id: parsed.data.id, date: await tenantDay(c, parsed.data.date), memo: parsed.data.memo, lines });
      return c.json(serialize(c, doc), 201);
    } catch (err) {
      if (err instanceof EmptyLandedCostTargetsError || err instanceof ZeroLandedCostWeightError) {
        return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
      }
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/confirm", gate("purchases.landed_cost.confirm"), async (c) => {
    if (!(await visibleLandedCost(c))) return c.json(DOCUMENT_NOT_FOUND, 404);
    try {
      const body = (await c.req.json().catch(() => ({}))) as { absorptionDate?: unknown } | null;
      const absorptionDate = typeof body?.absorptionDate === "string" && body.absorptionDate !== "" ? await tenantDay(c, body.absorptionDate) : undefined;
      const result = await landedCostService.confirm(c.req.param("id"), { actor: callerUserId(c), actorRoles: callerRoleCodes(c), today: await tenantToday(c), absorptionDate });
      return c.json({
        document: serialize(c, result.document, await approvalOf(documents, result.document)),
        held: result.held,
        // A landed cost that arrives after the goods were sold cannot raise the
        // basis of stock that is gone. That part is reclassified out of
        // inventory into cost of sales, and the caller is told how much and by
        // which entry rather than being left to wonder why the valuation report
        // moved by less than the document's total (D84).
        absorbedTotal: result.absorbedTotal.toString(),
        absorptionJournalEntryId: result.absorptionJournalEntryId,
        unabsorbedTotal: result.unabsorbedTotal.toString(),
        unabsorbedJournalEntryId: result.unabsorbedJournalEntryId,
        unabsorbed: result.unabsorbed.map((u) => ({
          itemId: u.itemId,
          warehouseId: u.warehouseId,
          sourceInvoiceId: u.sourceInvoiceId,
          amount: u.amount.toString(),
        })),
      });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  mountResubmitRoute(app, {
    permission: gate("purchases.landed_cost.confirm"),
    refuse: async (c) => ((await visibleLandedCost(c)) ? undefined : c.json(DOCUMENT_NOT_FOUND, 404)),
    resubmit: (c, id) => documents.resubmit(id, { actor: callerUserId(c), actorRoles: callerRoleCodes(c) }),
    serialize: async (c, doc) => serialize(c, doc, await approvalOf(documents, doc)),
    onError: handleDocumentError,
  });

  app.post("/:id/cancel", gate("purchases.landed_cost.void"), async (c) => {
    if (!(await visibleLandedCost(c))) return c.json(DOCUMENT_NOT_FOUND, 404);
    try {
      const doc = await documents.cancel(c.req.param("id"), { actor: callerUserId(c) });
      return c.json(serialize(c, doc));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/reverse", gate(ReversalPermission.LandedCost), async (c) => {
    const visible = await visibleLandedCost(c, MirrorAccess.Reachable);
    if (!visible) return c.json(DOCUMENT_NOT_FOUND, 404);
    const body = (await c.req.json().catch(() => ({}))) as { date?: unknown; reversalId?: unknown } | null;
    if (body?.date !== undefined && body.date !== null && (typeof body.date !== "string" || body.date.trim() === "")) {
      return c.json({ error: "VALIDATION_ERROR", message: "تاريخ العكس يجب أن يكون نصاً بصيغة YYYY-MM-DD.", messageEn: "The reversal date must be a YYYY-MM-DD string." }, 400);
    }
    const reversalId = clientSuppliedId.optional().safeParse(body?.reversalId === "" ? undefined : (body?.reversalId ?? undefined));
    if (!reversalId.success) return c.json({ error: "VALIDATION_ERROR", details: reversalId.error.flatten() }, 400);
    try {
      const date = await tenantDay(c, typeof body?.date === "string" ? body.date : new Date().toISOString());
      await noteReversalOriginalDay(c, visible.date);
      const result = await landedCostService.reverse(c.req.param("id"), {
        reversalId: reversalId.data ?? randomUUID(),
        date,
      });
      return c.json({ original: serialize(c, result.original), reversal: serialize(c, result.reversal) }, 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  return app;
}
