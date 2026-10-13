import { randomUUID } from "node:crypto";
import { Hono } from "hono";
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
} from "@mezan/domain";
import { ReversalPermission, createLandedCostSchema } from "@mezan/contracts";
import { type AuthContextResolver, callerRoleCodes, callerUserId, createPermissionGate } from "./permission-gate.js";
import { handleDocumentError } from "./document-error-handling.js";
import { approvalOf, approvalReader, mountResubmitRoute } from "./document-resubmit.js";
import type { DocumentApprovalDTO } from "@mezan/contracts";
import { noteReversalOriginalDay } from "./posting-refusal.js";
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

function serialize(doc: FrameworkDocument<LandedCostLine>, approval: DocumentApprovalDTO | null = null) {
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
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("purchases.landed_cost.view"), async (c) => {
    const status = c.req.query("status");
    const list = await documents.list({ status: status as never });
    const approval = await approvalReader(documents, list);
    return c.json(list.map((doc) => serialize(doc, approval(doc))));
  });

  app.get("/:id", gate("purchases.landed_cost.view"), async (c) => {
    const doc = await documents.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(doc, await approvalOf(documents, doc)));
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
      const targets = parsed.data.targets.map((t) => ({
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
      return c.json(serialize(doc), 201);
    } catch (err) {
      if (err instanceof EmptyLandedCostTargetsError || err instanceof ZeroLandedCostWeightError) {
        return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
      }
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/confirm", gate("purchases.landed_cost.confirm"), async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { absorptionDate?: unknown } | null;
      const absorptionDate = typeof body?.absorptionDate === "string" && body.absorptionDate !== "" ? await tenantDay(c, body.absorptionDate) : undefined;
      const result = await landedCostService.confirm(c.req.param("id"), { actor: callerUserId(c), actorRoles: callerRoleCodes(c), today: await tenantToday(c), absorptionDate });
      return c.json({
        document: serialize(result.document, await approvalOf(documents, result.document)),
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
    resubmit: (c, id) => documents.resubmit(id, { actor: callerUserId(c), actorRoles: callerRoleCodes(c) }),
    serialize: async (_c, doc) => serialize(doc, await approvalOf(documents, doc)),
    onError: handleDocumentError,
  });

  app.post("/:id/cancel", gate("purchases.landed_cost.void"), async (c) => {
    try {
      const doc = await documents.cancel(c.req.param("id"), { actor: callerUserId(c) });
      return c.json(serialize(doc));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/reverse", gate(ReversalPermission.LandedCost), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { date?: unknown; reversalId?: unknown } | null;
    if (body?.date !== undefined && body.date !== null && (typeof body.date !== "string" || body.date.trim() === "")) {
      return c.json({ error: "VALIDATION_ERROR", message: "تاريخ العكس يجب أن يكون نصاً بصيغة YYYY-MM-DD.", messageEn: "The reversal date must be a YYYY-MM-DD string." }, 400);
    }
    try {
      const date = await tenantDay(c, typeof body?.date === "string" ? body.date : new Date().toISOString());
      await noteReversalOriginalDay(c, (await documents.findById(c.req.param("id")))?.date);
      const result = await landedCostService.reverse(c.req.param("id"), {
        reversalId: typeof body?.reversalId === "string" && body.reversalId !== "" ? body.reversalId : randomUUID(),
        date,
      });
      return c.json({ original: serialize(result.original), reversal: serialize(result.reversal) }, 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  return app;
}
