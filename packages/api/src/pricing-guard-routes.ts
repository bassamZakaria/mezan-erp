import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  AuditChangeAction,
  DuplicateRecordIdError,
  InvalidPricingGuardRuleError,
  Money,
  PricingGuardBlockedError,
  PricingGuardApprovalUnconfiguredError,
  PricingGuardChangedError,
  PricingGuardDocType,
  PricingGuardRuleStatus,
  Qty,
  can,
  computeInvoiceTotals,
  createPricingGuardRule,
  formatBasisPoints,
  revisePricingGuardRule,
  setPricingGuardRuleStatus,
  toBaseQty,
  type AuditSink,
  type DocumentPricingGuardPort,
  type PricingGuardBreach,
  type PricingGuardEvaluation,
  type PricingGuardMode,
  type PricingGuardOverride,
  type PricingGuardOverrideRepository,
  type PricingGuardRule,
  type PricingGuardRuleRepository,
  type SalesInvoiceLine,
} from "@mezan/domain";
import {
  createPricingGuardRuleSchema,
  pricingGuardEvaluateRequestSchema,
  pricingGuardOverrideQuerySchema,
  pricingGuardRuleInputSchema,
  setPricingGuardRuleStatusSchema,
  PricingGuardDiscountTypeDTO,
  type PricingGuardRuleInputDTO,
} from "@mezan/contracts";
import { branchScopeOf, createAnyPermissionGate, createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { recordFieldChanges } from "./admin-audit.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { postingRefusalResponse } from "./posting-refusal.js";

export const PRICING_GUARD_VIEW_PERMISSION = "sales.pricing_guard.view";
export const PRICING_GUARD_MANAGE_PERMISSION = "sales.pricing_guard.manage";
const VIEW_COST_PERMISSION = "sales.invoice.view_cost";
const AUDIT_MODULE = "sales";
const RULE_ENTITY = "PRICING_GUARD_RULE";
const AUDITED_RULE_FIELDS = ["nameAr", "itemId", "categoryId", "customerCategory", "floorPrice", "minMarginPercent", "mode", "status", "note"] as const;
const RULE_WARN_FIELDS = ["floorPrice", "minMarginPercent", "mode", "status"];

export interface PricingGuardRoutesDeps {
  readonly rules: PricingGuardRuleRepository;
  readonly overrides: PricingGuardOverrideRepository;
  readonly guard: DocumentPricingGuardPort;
  readonly itemExists: (itemId: string) => Promise<boolean>;
  readonly categoryExists: (categoryId: string) => Promise<boolean>;
  readonly customerTaxExempt?: (customerId: string) => Promise<boolean>;
  readonly approvalOf?: (requestId: string) => Promise<{ readonly submittedBy: string; readonly approvedBy: readonly string[] } | null>;
  readonly userName?: (userId: string) => Promise<string | null>;
  readonly audit?: AuditSink;
  readonly now?: () => string;
  readonly idGen?: () => string;
}

/** SECURITY: cost and margin leave the server only for a caller who may see cost (D94) — omitted, never nulled. */
export function maySeeCost(c: Context): boolean {
  const ctx = getAuthContext(c);
  return ctx ? can(ctx, VIEW_COST_PERMISSION) : false;
}

export function serializeBreach(breach: PricingGuardBreach) {
  return {
    ruleId: breach.ruleId,
    ruleNameAr: breach.ruleNameAr,
    kind: breach.kind,
    mode: breach.mode,
    floorPrice: breach.floorPrice?.toString() ?? null,
    minMarginPercent: breach.minMarginPercent,
  };
}

export function serializePricingGuardEvaluation(evaluation: PricingGuardEvaluation, showCost: boolean) {
  return {
    outcome: evaluation.outcome,
    costVisible: showCost,
    lines: evaluation.lines.map((line) => ({
      lineId: line.lineId,
      itemId: line.itemId,
      outcome: line.outcome,
      breaches: line.breaches.map(serializeBreach),
      netUnitPrice: line.netUnitPrice?.toString() ?? null,
      ...(showCost
        ? {
            unitCost: line.unitCost?.toString() ?? null,
            costBasis: line.costBasis,
            marginPercent: line.marginBasisPoints === null ? null : formatBasisPoints(line.marginBasisPoints),
          }
        : {}),
    })),
  };
}

export function pricingGuardRefusal(c: Context, err: unknown): Response | null {
  if (err instanceof PricingGuardBlockedError || err instanceof PricingGuardApprovalUnconfiguredError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, lines: err.lines }, 422);
  }
  if (err instanceof PricingGuardChangedError) return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  return null;
}

function serializeRule(rule: PricingGuardRule) {
  return {
    id: rule.id,
    nameAr: rule.nameAr,
    itemId: rule.itemId,
    categoryId: rule.categoryId,
    customerCategory: rule.customerCategory,
    floorPrice: rule.floorPrice?.toString() ?? null,
    minMarginPercent: rule.minMarginPercent,
    mode: rule.mode,
    status: rule.status,
    note: rule.note,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
  };
}

function ruleInputOf(dto: PricingGuardRuleInputDTO) {
  return {
    nameAr: dto.nameAr,
    itemId: dto.itemId,
    categoryId: dto.categoryId,
    customerCategory: dto.customerCategory,
    floorPrice: dto.floorPrice === null ? null : Money.fromMajor(dto.floorPrice),
    minMarginPercent: dto.minMarginPercent,
    mode: dto.mode as unknown as PricingGuardMode,
    note: dto.note,
  };
}

interface OverridePeople {
  readonly submittedBy: string;
  readonly submittedByName: string | null;
  readonly approvedBy: readonly string[];
  readonly approvedByNames: readonly string[];
}

function serializeOverride(row: PricingGuardOverride, showCost: boolean, people: OverridePeople) {
  return {
    id: row.id,
    docType: row.docType,
    docId: row.docId,
    docNo: row.docNo,
    docDate: row.docDate,
    customerId: row.customerId,
    customerNameAr: row.customerNameAr,
    branchId: row.branchId,
    lineId: row.lineId,
    itemId: row.itemId,
    baseQty: row.baseQty.toString(),
    netBase: row.netBase.toString(),
    netUnitPrice: row.netUnitPrice.toString(),
    ...(showCost
      ? {
          unitCost: row.unitCost?.toString() ?? null,
          costBasis: row.costBasis,
          marginPercent: row.marginBasisPoints === null ? null : formatBasisPoints(row.marginBasisPoints),
        }
      : {}),
    breaches: row.breaches.map(serializeBreach),
    kind: row.kind,
    approvalRequestId: row.approvalRequestId,
    submittedBy: people.submittedBy,
    submittedByName: people.submittedByName,
    approvedBy: [...people.approvedBy],
    approvedByNames: [...people.approvedByNames],
    actor: row.actor,
    recordedAt: row.recordedAt,
  };
}

function handleRuleError(c: Context, err: unknown): Response {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof InvalidPricingGuardRuleError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, reasons: err.reasonsAr, reasonsEn: err.reasonsEn }, 422);
  }
  throw err;
}

// SECURITY: POST /evaluate is a preview and writes nothing; it never accepts a cost from the caller.
export function createPricingGuardRoutes(deps: PricingGuardRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);
  const now = deps.now ?? (() => new Date().toISOString());
  const idGen = deps.idGen ?? (() => randomUUID());
  const actorOf = (c: Context) => getAuthContext(c)?.userId ?? "system";

  async function refuseUnknownTargets(c: Context, dto: PricingGuardRuleInputDTO): Promise<Response | null> {
    if (dto.itemId && !(await deps.itemExists(dto.itemId))) {
      return c.json({ error: "ITEM_NOT_FOUND", message: `الصنف "${dto.itemId}" غير موجود.`, messageEn: `Item "${dto.itemId}" was not found.` }, 422);
    }
    if (dto.categoryId && !(await deps.categoryExists(dto.categoryId))) {
      return c.json({ error: "ITEM_CATEGORY_NOT_FOUND", message: `فئة الأصناف "${dto.categoryId}" غير موجودة.`, messageEn: `Item category "${dto.categoryId}" was not found.` }, 422);
    }
    return null;
  }

  app.get("/rules", gate(PRICING_GUARD_VIEW_PERMISSION), async (c) => {
    return c.json((await deps.rules.list()).map(serializeRule));
  });

  app.post("/rules", gate(PRICING_GUARD_MANAGE_PERMISSION), async (c) => {
    const parsed = createPricingGuardRuleSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const refused = await refuseUnknownTargets(c, parsed.data);
    if (refused) return refused;
    try {
      const rule = createPricingGuardRule(idGen(), ruleInputOf(parsed.data), actorOf(c), now());
      await deps.rules.insert(rule);
      await recordFieldChanges(deps.audit, c, {
        entity: { module: AUDIT_MODULE, entityType: RULE_ENTITY, entityId: rule.id },
        action: AuditChangeAction.Create,
        before: null,
        after: serializeRule(rule),
        fields: AUDITED_RULE_FIELDS,
        severity: "WARNING",
      });
      return c.json(serializeRule(rule), 201);
    } catch (err) {
      return handleRuleError(c, err);
    }
  });

  app.put("/rules/:id", gate(PRICING_GUARD_MANAGE_PERMISSION), async (c) => {
    const parsed = pricingGuardRuleInputSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const current = await deps.rules.findById(c.req.param("id"));
    if (!current) return c.json({ error: "PRICING_GUARD_RULE_NOT_FOUND" }, 404);
    const refused = await refuseUnknownTargets(c, parsed.data);
    if (refused) return refused;
    try {
      const revised = revisePricingGuardRule(current, ruleInputOf(parsed.data), actorOf(c), now());
      await deps.rules.save(revised);
      await recordFieldChanges(deps.audit, c, {
        entity: { module: AUDIT_MODULE, entityType: RULE_ENTITY, entityId: revised.id },
        action: AuditChangeAction.Update,
        before: serializeRule(current),
        after: serializeRule(revised),
        fields: AUDITED_RULE_FIELDS,
        warnOn: RULE_WARN_FIELDS,
      });
      return c.json(serializeRule(revised));
    } catch (err) {
      return handleRuleError(c, err);
    }
  });

  app.post("/rules/:id/status", gate(PRICING_GUARD_MANAGE_PERMISSION), async (c) => {
    const parsed = setPricingGuardRuleStatusSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const current = await deps.rules.findById(c.req.param("id"));
    if (!current) return c.json({ error: "PRICING_GUARD_RULE_NOT_FOUND" }, 404);
    const status = parsed.data.status as unknown as PricingGuardRuleStatus;
    if (current.status === status) return c.json(serializeRule(current));
    const next = setPricingGuardRuleStatus(current, status, actorOf(c), now());
    await deps.rules.save(next);
    await recordFieldChanges(deps.audit, c, {
      entity: { module: AUDIT_MODULE, entityType: RULE_ENTITY, entityId: next.id },
      action: status === PricingGuardRuleStatus.Active ? AuditChangeAction.Activate : AuditChangeAction.Deactivate,
      before: serializeRule(current),
      after: serializeRule(next),
      fields: AUDITED_RULE_FIELDS,
      severity: "WARNING",
    });
    return c.json(serializeRule(next));
  });

  app.post("/evaluate", gateAny("sales.invoice.create", "sales.invoice.edit", "sales.quote.create", "sales.quote.edit"), async (c) => {
    const parsed = pricingGuardEvaluateRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const d = parsed.data;
    const isInvoice = d.docType === (PricingGuardDocType.SalesInvoice as string);
    const lines: SalesInvoiceLine[] = d.lines.map((line) => {
      const qty = Qty.fromMajor(line.qty);
      const factor = isInvoice ? line.unitFactor : 1;
      return {
        lineId: line.lineId,
        itemId: line.itemId,
        itemNameAr: "",
        isStock: true,
        qty,
        unitCode: "",
        unitFactor: factor,
        baseQty: factor === 1 ? qty : toBaseQty(qty, factor),
        unitPrice: Money.fromMajor(line.unitPrice),
        discountType: line.discountType === PricingGuardDiscountTypeDTO.Amount ? "amount" : "percent",
        discountPercent: line.discountPercent,
        discountAmount: Money.fromMajor(line.discountAmount),
        taxRatePercent: line.taxRatePercent,
        taxRateId: null,
        revenueAccountId: "",
        cogsAccountId: null,
        inventoryAccountId: null,
        costCenterId: null,
        unitCost: null,
      };
    });
    const taxExempt = (await deps.customerTaxExempt?.(d.customerId)) ?? false;
    const totals = computeInvoiceTotals(
      lines,
      d.discount.type === PricingGuardDiscountTypeDTO.Amount ? { type: "amount", amount: Money.fromMajor(d.discount.amount) } : { type: "percent", percent: d.discount.percent },
      { taxExempt, taxInclusive: d.taxInclusive },
    );
    const netByLine = new Map(totals.lines.map((line) => [line.lineId, line.taxableBase]));
    const evaluation = await deps.guard.evaluate({
      docType: isInvoice ? PricingGuardDocType.SalesInvoice : PricingGuardDocType.SalesQuote,
      docId: "preview",
      date: d.date,
      customerId: d.customerId,
      branchId: d.branchId,
      warehouseId: isInvoice ? (d.warehouseId ?? null) : null,
      currency: d.currency,
      lines: lines.map((line) => ({ lineId: line.lineId, itemId: line.itemId, baseQty: line.baseQty, netAmount: netByLine.get(line.lineId) ?? Money.zero() })),
    });
    return c.json(serializePricingGuardEvaluation(evaluation, maySeeCost(c)));
  });

  app.get("/overrides", gate(PRICING_GUARD_VIEW_PERMISSION), async (c) => {
    const parsed = pricingGuardOverrideQuerySchema.safeParse({
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
      customerId: c.req.query("customerId"),
      itemId: c.req.query("itemId"),
      docType: c.req.query("docType"),
    });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const rows = await deps.overrides.list({
      ...parsed.data,
      docType: parsed.data.docType as unknown as PricingGuardDocType | undefined,
      branchScope: branchScopeOf(c) ?? null,
    });
    const showCost = maySeeCost(c);
    const names = new Map<string, string | null>();
    const nameOf = async (userId: string) => {
      if (!names.has(userId)) names.set(userId, (await deps.userName?.(userId)) ?? null);
      return names.get(userId) ?? null;
    };
    const approvals = new Map<string, { submittedBy: string; approvedBy: readonly string[] } | null>();
    const people: OverridePeople[] = [];
    for (const row of rows) {
      const requestId = row.approvalRequestId;
      if (requestId && !approvals.has(requestId)) approvals.set(requestId, (await deps.approvalOf?.(requestId)) ?? null);
      const approval = requestId ? approvals.get(requestId) ?? null : null;
      const submittedBy = approval?.submittedBy ?? row.actor;
      const approvedBy = approval?.approvedBy ?? [];
      people.push({
        submittedBy,
        submittedByName: await nameOf(submittedBy),
        approvedBy,
        approvedByNames: await Promise.all(approvedBy.map(async (id) => (await nameOf(id)) ?? id)),
      });
    }
    return c.json({
      costVisible: showCost,
      rows: rows.map((row, index) => serializeOverride(row, showCost, people[index] as OverridePeople)),
    });
  });

  return app;
}
