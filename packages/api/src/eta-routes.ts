import { postingRefusalResponse } from "./posting-refusal.js";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  EtaVatSubTypeCode,
  TaxRateStatusCode,
  ETA_ACTIVITY_CODES,
  ETA_UNIT_CODES,
  EtaService,
  isEtaUnitCode,
  computeEtaReadiness,
  searchEtaActivityCodes,
  suggestEtaUnitCode,
  DuplicateEtaSubmissionError,
  EtaExclusionReasonRequiredError,
  EtaDeviceSerialNotRegisteredError,
  EtaReceiptChainConflictError,
  EtaRefundReferenceRequiredError,
  EtaReceiptNotReadyError,
  EtaBuyerIdentityRequiredError,
  EtaRefundTooLateError,
  EtaOriginalReceiptNotFoundError,
  EtaDeviceSerialUnknownError,
  EtaMissingExchangeRateError,
  EtaReissueNotRejectedError,
  EtaReceiptNotASupplyError,
  EtaReissueWindowExpiredError,
  EtaReissueSameInternalIdError,
  ETA_RECEIPT_PAYMENT_METHODS,
  EtaOfflineError,
  EtaPrevalidationFailedError,
  EtaPrevalidationSeverity,
  EtaReceiptUuidUnavailableError,
  EtaSignerNotConfiguredError,
  EtaSigningFailedError,
  EtaSubmissionNotFoundError,
  EtaSubmissionInFlightError,
  InvalidEtaTransitionError,
  type EtaBranchCodeRepository,
  type EtaConfig,
  type EtaReadinessCounts,
  type EtaChainedReceiptInput,
  type EtaPrevalidationFinding,
  type EtaReceiptPaymentMethod,
  type EtaSubmission,
  type EtaSubmissionStatus,
  type EtaUnitMappingRepository,
  type Item,
  type ItemRepository,
  type ItemUnitRepository,
  type BranchRepository,
  type TaxRateRepository,
  AuditChangeAction,
  type AuditSink,
  EtaReceiptSourceKind,
  parseEtaReceiptSourceKind,
} from "@mezan/domain";
import { recordFieldChanges } from "./admin-audit.js";
import {
  updateEtaConfigSchema,
  excludeEtaSubmissionSchema,
  updateEtaBranchCodeSchema,
  updateEtaItemMappingSchema,
  updateEtaUnitMappingSchema,
  bulkRequeueSubmitSchema,
  EtaBulkRequeueOutcome,
} from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

export interface EtaRoutesDeps {
  readonly service: EtaService;
  /** Stores the encrypted client secret (never returned). Wired to the persistence store. */
  readonly setClientSecret?: (secret: string) => Promise<void>;
  /** The masters whose records need a code registered with the authority. */
  readonly items?: ItemRepository;
  readonly units?: ItemUnitRepository;
  readonly branches?: BranchRepository;
  readonly taxRates?: TaxRateRepository;
  readonly branchCodes?: EtaBranchCodeRepository;
  readonly unitMappings?: EtaUnitMappingRepository;
  /** الاسم التجاري — the seller name every receipt must carry (tenant settings). */
  readonly companyTradeName?: () => Promise<string>;
  /**
   * Re-issues the receipt of a consumer sale or return that failed to receipt
   * (a gap), once its cause is fixed. Wired to the backend's receipt issuer.
   */
  readonly issueDocumentReceipt?: (
    kind: EtaReceiptSourceKind,
    docId: string,
  ) => Promise<{ receiptNo: string; uuid: string; qrValue: string } | null>;
  /**
   * D-B4 — corrects and re-issues a receipt the authority REJECTED, inside its
   * 96-hour correction window, referencing the rejected receipt's own UUID.
   * Null when the document's receipt was never rejected — nothing to correct.
   */
  readonly reissueDocumentReceipt?: (
    kind: EtaReceiptSourceKind,
    docId: string,
  ) => Promise<{ receiptNo: string; uuid: string; qrValue: string } | null>;
  /**
   * إصلاح وإعادة الطابور (ENH-011b, WF-04 step 4) — rebuilds one submission's
   * payload and pre-validation from the current source document and masters.
   * Null when the document type has no rebuild path (a receipt) or the source
   * document no longer resolves to a live B2B document.
   */
  readonly rebuildSubmission?: (
    submission: EtaSubmission,
  ) => Promise<{ readonly payload: unknown; readonly prevalidation: readonly EtaPrevalidationFinding[] } | null>;
}

function itemNeedsCode(item: Item): boolean {
  return item.type !== "service" && (!item.etaItemCode || !item.etaCodeType);
}

/**
 * How many records of each master still lack a code the authority recognises.
 * Items and tax rates hold their codes on their own rows; branches and units
 * hold theirs in the ETA module's own mapping tables.
 */
async function readinessCounts(deps: EtaRoutesDeps): Promise<EtaReadinessCounts | undefined> {
  if (!deps.items || !deps.units || !deps.branches || !deps.taxRates || !deps.branchCodes || !deps.unitMappings) {
    return undefined;
  }
  const [items, units, branches, taxRates, branchCodes, unitMappings] = await Promise.all([
    deps.items.list(),
    deps.units.list(),
    deps.branches.findAll(),
    deps.taxRates.list(),
    deps.branchCodes.list(),
    deps.unitMappings.list(),
  ]);
  const codedBranches = new Set(branchCodes.map((b) => b.branchId));
  const mappedUnits = new Set(unitMappings.map((u) => u.unitCode));
  return {
    branchesMissingCode: branches.filter((b) => b.active && !codedBranches.has(b.id)).length,
    itemsMissingCode: items.filter((i) => i.status === "active" && itemNeedsCode(i)).length,
    unitsMissingMapping: units.filter((u) => u.status === "active" && !mappedUnits.has(u.code)).length,
    taxRatesMissingSubType: taxRates.filter((t) => t.status === TaxRateStatusCode.Active && t.etaSubType === EtaVatSubTypeCode.Auto).length,
  };
}

function serializeConfig(config: EtaConfig, counts?: EtaReadinessCounts) {
  return {
    config: {
      environment: config.environment,
      taxRegistrationNumber: config.taxRegistrationNumber,
      activityCode: config.activityCode,
      address: config.address,
      buyerDataThreshold: config.buyerDataThreshold,
      documentVersion: config.documentVersion,
      autoSubmitOnConfirm: config.autoSubmitOnConfirm,
      signingMethod: config.signingMethod,
      clientId: config.clientId,
      hasClientSecret: config.hasClientSecret,
      preproductionIdentityUrl: config.preproductionIdentityUrl,
      preproductionApiUrl: config.preproductionApiUrl,
      productionIdentityUrl: config.productionIdentityUrl,
      productionApiUrl: config.productionApiUrl,
      signingCommand: config.signingCommand,
      signingCommandArgs: config.signingCommandArgs,
      receiptReportingWindowHours: config.receiptReportingWindowHours,
    },
    readiness: computeEtaReadiness(config, counts),
  };
}

/**
 * The queue row. The payload is deliberately OFF the list — it is large and no
 * list screen reads it — and available on `GET /submissions/:id` instead
 * (D121). Before that it was reachable from nowhere at all: the one thing
 * that will actually be filed with the authority could not be inspected by a
 * screen or an auditor.
 */
function serializeSubmission(s: EtaSubmission, opts: { payload?: boolean } = {}) {
  const prevalidation = s.prevalidation ?? [];
  return {
    ...(opts.payload ? { payload: s.payload, transmitLog: s.transmitLog } : {}),
    id: s.id,
    internalId: s.internalId,
    documentType: s.documentType,
    status: s.status,
    etaUuid: s.etaUuid,
    errors: s.errors,
    rejectionCodes: s.rejectionCodes ?? [],
    exclusionReason: s.exclusionReason,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    submittedAt: s.submittedAt,
    gatewaySubmissionId: s.gatewaySubmissionId,
    signed: s.signature !== null,
    prevalidation,
    hasBlockingFindings: prevalidation.some((f) => f.severity === EtaPrevalidationSeverity.Blocking),
  };
}

function handleError(c: Context, err: unknown): Response {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof EtaSubmissionNotFoundError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 404);
  }
  if (err instanceof DuplicateEtaSubmissionError || err instanceof EtaSubmissionInFlightError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof InvalidEtaTransitionError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  if (err instanceof EtaExclusionReasonRequiredError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 400);
  }
  // Not configured for the network yet: the document stays queued, which is a
  // state, not a failure.
  if (err instanceof EtaOfflineError) return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 202);
  if (err instanceof EtaSignerNotConfiguredError) return c.json({ error: err.code, message: err.message }, 422);
  if (err instanceof EtaSigningFailedError) return c.json({ error: err.code, message: err.message }, 422);
  // No UUID service means no receipt can be issued at all — a configuration
  // gap, not a bad request, and it must not read as one.
  if (err instanceof EtaReceiptUuidUnavailableError) return c.json({ error: err.code, message: err.message }, 501);
  // A till whose device is not registered must be told so, loudly — not have a
  // receipt filed with a blank serial the authority will not accept.
  if (err instanceof EtaDeviceSerialNotRegisteredError) return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  if (err instanceof EtaRefundReferenceRequiredError) return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 400);
  if (err instanceof EtaReceiptNotASupplyError) return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  // D-B4 — a rejected receipt corrected too late, twice, or not rejected at all.
  if (
    err instanceof EtaReissueWindowExpiredError ||
    err instanceof EtaReissueNotRejectedError ||
    err instanceof EtaReissueSameInternalIdError
  ) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  if (
    err instanceof EtaReceiptNotReadyError ||
    err instanceof EtaBuyerIdentityRequiredError ||
    err instanceof EtaRefundTooLateError ||
    err instanceof EtaOriginalReceiptNotFoundError ||
    err instanceof EtaDeviceSerialUnknownError
  ) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  if (err instanceof EtaMissingExchangeRateError) return c.json({ error: err.code, message: err.message }, 422);
  if (err instanceof EtaReceiptChainConflictError) return c.json({ error: err.code, message: err.message }, 409);
  // ENH-011b: blocked before transmit — every failing rule, not just the
  // first, so a "Fix & Requeue" pass clears the batch in one read.
  if (err instanceof EtaPrevalidationFailedError) {
    return c.json({ error: err.code, message: err.message, findings: err.findings }, 422);
  }
  throw err;
}


/**
 * Money on an e-receipt travels as an exact decimal string, never a float —
 * the till has already rounded, and re-parsing through a JS number is how a
 * receipt total stops matching the drawer.
 */
const AMOUNT = z.string().regex(/^-?\d+(\.\d+)?$/, "المبلغ يجب أن يكون رقماً عشرياً");

const receiptLineSchema = z.object({
  internalCode: z.string().min(1),
  description: z.string().min(1),
  itemType: z.string().min(1),
  itemCode: z.string().min(1),
  unitType: z.string().min(1),
  quantity: AMOUNT,
  unitPrice: AMOUNT,
  totalSale: AMOUNT,
  netSale: AMOUNT,
  total: AMOUNT,
  commercialDiscount: AMOUNT.optional(),
  itemDiscount: AMOUNT.optional(),
  taxSubType: z.string().min(1),
  taxRate: z.string(),
  taxAmount: AMOUNT,
});

const issueReceiptSchema = z.object({
  internalId: z.string().min(1),
  issueDateTime: z.string().min(1),
  receiptType: z.enum(["sale", "refund"]),
  // No previousUuid: the device's chain supplies it (D283). A caller-stated
  // predecessor is how two receipts end up claiming the same link.
  currency: z.string().optional(),
  exchangeRate: AMOUNT.optional(),
  /** The sale receipt a refund returns (header.referenceUUID). */
  referenceUuid: z.string().nullable().optional(),
  /** Only when re-issuing a receipt the authority rejected. */
  referenceOldUuid: z.string().nullable().optional(),
  // The till identity is NOT caller-supplied: the branch says which device the
  // authority has registered, and the serial and branch code are read from it.
  seller: z.object({
    branchId: z.string().min(1),
    syndicateLicenseNumber: z.string().nullable().optional(),
  }),
  buyer: z.object({
    type: z.enum(["B", "P", "F"]),
    id: z.string().nullable().default(null),
    name: z.string().nullable().default(null),
    mobileNumber: z.string().nullable().optional(),
  }),
  paymentMethod: z.enum(ETA_RECEIPT_PAYMENT_METHODS as [EtaReceiptPaymentMethod, ...EtaReceiptPaymentMethod[]]),
  lines: z.array(receiptLineSchema).min(1),
  totalSales: AMOUNT,
  totalCommercialDiscount: AMOUNT.optional(),
  totalItemsDiscount: AMOUNT.optional(),
  netAmount: AMOUNT,
  feesAmount: AMOUNT.optional(),
  totalAmount: AMOUNT,
  taxTotals: z.array(z.object({ taxType: z.string().min(1), amount: AMOUNT })),
});

/**
 * The till the authority has registered for this branch. A receipt is bound to
 * a device serial, so a branch with none cannot issue one at all.
 */
async function resolveReceiptDevice(
  deps: EtaRoutesDeps,
  branchId: string,
): Promise<{ readonly deviceSerialNumber: string; readonly etaBranchCode: string | null }> {
  const mapping = deps.branchCodes
    ? (await deps.branchCodes.list()).find((m) => m.branchId === branchId)
    : undefined;
  const serial = mapping?.deviceSerialNumber?.trim() ?? "";
  if (serial === "") throw new EtaDeviceSerialNotRegisteredError(branchId);
  return { deviceSerialNumber: serial, etaBranchCode: mapping?.etaBranchCode ?? null };
}

/**
 * الفاتورة الإلكترونية (ETA) routes (docs/archive/catalog/04), mounted under `/eta`:
 *   GET  /config                       config + readiness
 *   PUT  /config                       update config (clientSecret stored, never returned)
 *   GET  /submissions[?status=]        the submission queue
 *   POST /submissions/:id/submit       submit one (signs when required, then transmits)
 *   POST /submissions/submit-all       إرسال كل الجاهز
 *   POST /submissions/process          معالجة القائمة: توقيع وإرسال ثم متابعة الحالة
 *   POST /submissions/:id/refresh-status  تحديث حالة مستند مرسل من المصلحة
 *   POST /submissions/:id/accept       authority acceptance callback (demo/testing)
 *   POST /submissions/:id/exclude      مستبعد (reason required)
 *   GET  /activity-codes[?q=]          كود النشاط lookup
 *   GET  /unit-codes                   the authority's unit-of-measure codes
 *   POST /test-connection              اختبار الاتصال (real token request)
 *   GET  /branch-codes                 أكواد الفروع لدى المصلحة
 *   PUT  /branch-codes/:branchId       register one branch's code
 *   GET  /item-mappings[?unmapped=1&q=] ربط الأصناف
 *   PUT  /item-mappings/:itemId        set an item's EGS/GPC codes
 *   GET  /unit-mappings                ربط الوحدات
 *   PUT  /unit-mappings/:unitCode      map one unit
 *   POST /unit-mappings/apply-suggestions تطبيق الاقتراحات
 *   GET  /tax-subtypes                 أنواع الضريبة الفرعية per tax rate
 *   GET  /receipts/summary             ما لم يُبلَّغ من الإيصالات + ما تجاوز مهلة الإبلاغ
 *   POST /receipts                     إصدار إيصال إلكتروني (idempotent — a reprint reuses the UUID)
 *   GET  /receipts/gaps                إيصالات لم تصدر، مع السبب
 *   POST /receipts/issue/:kind/:docId  إصدار إيصال لمستند فاتته (kind = invoice | return)
 *   POST /receipts/reissue/:kind/:docId تصحيح إيصال مرفوض وإعادة إصداره خلال 96 ساعة (kind = invoice | return)
 *   GET  /receipts/:internalId         إعادة طباعة — the stored UUID and QR
 * Permissions: eta.view (reads), eta.submit (config write + submit), eta.cancel (exclude).
 */
export function createEtaRoutes(
  deps: EtaRoutesDeps,
  resolveAuthContext: AuthContextResolver,
  audit?: AuditSink,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const { service } = deps;

  app.get("/config", gate("accounting.eta.view"), async (c) => {
    return c.json(serializeConfig(await service.getConfig(), await readinessCounts(deps)));
  });

  app.put("/config", gate("accounting.eta.submit"), async (c) => {
    const parsed = updateEtaConfigSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const current = await service.getConfig();
    const { clientSecret, ...patch } = parsed.data;
    const next: EtaConfig = {
      ...current,
      ...patch,
      address: patch.address !== undefined ? patch.address : current.address,
    };
    await service.saveConfig(next);
    if (clientSecret && deps.setClientSecret) await deps.setClientSecret(clientSecret);
    return c.json(serializeConfig(await service.getConfig(), await readinessCounts(deps)));
  });

  app.get("/activity-codes", gate("accounting.eta.view"), (c) => {
    // The picker filters client-side over whatever this returns, so a truncated
    // list is a lookup that silently cannot find half the codes.
    return c.json(searchEtaActivityCodes(c.req.query("q") ?? "", ETA_ACTIVITY_CODES.length));
  });

  app.get("/unit-codes", gate("accounting.eta.view"), (c) => c.json(ETA_UNIT_CODES));

  /**
   * اختبار الاتصال — a REAL OAuth2 client-credentials request against the
   * authority's identity server. It opens no socket when no credentials are
   * stored, and reports what actually came back rather than a fixed answer.
   */
  app.post("/test-connection", gate("accounting.eta.submit"), async (c) => {
    return c.json(await service.testConnection());
  });

  app.get("/branch-codes", gate("accounting.eta.view"), async (c) => {
    if (!deps.branches || !deps.branchCodes) return c.json([]);
    const [branches, codes] = await Promise.all([deps.branches.findAll(), deps.branchCodes.list()]);
    const byId = new Map(codes.map((m) => [m.branchId, m]));
    return c.json(
      branches
        .filter((b) => b.active)
        .map((b) => {
          const mapping = byId.get(b.id) ?? null;
          return {
            branchId: b.id,
            branchCode: b.code,
            branchName: b.name,
            etaBranchCode: mapping?.etaBranchCode ?? null,
            deviceSerialNumber: mapping?.deviceSerialNumber ?? null,
            posClientId: mapping?.posClientId ?? null,
            hasPosClientSecret: mapping?.hasPosClientSecret ?? false,
            posOsVersion: mapping?.posOsVersion ?? null,
            posModelFramework: mapping?.posModelFramework ?? null,
            hasPosPresharedKey: mapping?.hasPosPresharedKey ?? false,
          };
        }),
    );
  });

  app.put("/branch-codes/:branchId", gate("accounting.eta.submit"), async (c) => {
    if (!deps.branches || !deps.branchCodes) return c.json({ error: "NOT_CONFIGURED" }, 404);
    const parsed = updateEtaBranchCodeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const branchId = c.req.param("branchId");
    const branch = await deps.branches.findById(branchId);
    if (!branch) return c.json({ error: "BRANCH_NOT_FOUND", message: `Branch ${branchId} does not exist` }, 404);
    const current = (await deps.branchCodes.list()).find((m) => m.branchId === branchId) ?? null;
    const { posClientSecret, posPresharedKey, ...patch } = parsed.data;
    const etaBranchCode = patch.etaBranchCode.trim();
    const deviceSerialNumber =
      patch.deviceSerialNumber !== undefined
        ? (patch.deviceSerialNumber?.trim() || null)
        : (current?.deviceSerialNumber ?? null);
    const posClientId =
      patch.posClientId !== undefined ? (patch.posClientId?.trim() || null) : (current?.posClientId ?? null);
    const posOsVersion =
      patch.posOsVersion !== undefined ? (patch.posOsVersion?.trim() || null) : (current?.posOsVersion ?? null);
    const posModelFramework =
      patch.posModelFramework !== undefined
        ? (patch.posModelFramework?.trim() || null)
        : (current?.posModelFramework ?? null);
    await deps.branchCodes.save({
      branchId,
      etaBranchCode,
      deviceSerialNumber,
      posClientId,
      hasPosClientSecret: current?.hasPosClientSecret ?? false,
      posOsVersion,
      posModelFramework,
      hasPosPresharedKey: current?.hasPosPresharedKey ?? false,
    });
    if (posClientSecret) await deps.branchCodes.setPosClientSecret(branchId, posClientSecret);
    if (posPresharedKey && deps.branchCodes.setPosPresharedKey) {
      await deps.branchCodes.setPosPresharedKey(branchId, posPresharedKey);
    }
    return c.json({
      branchId,
      branchCode: branch.code,
      branchName: branch.name,
      etaBranchCode,
      deviceSerialNumber,
      posClientId,
      hasPosClientSecret: !!posClientSecret || (current?.hasPosClientSecret ?? false),
      posOsVersion,
      posModelFramework,
      hasPosPresharedKey: !!posPresharedKey || (current?.hasPosPresharedKey ?? false),
    });
  });

  app.get("/item-mappings", gate("accounting.eta.view"), async (c) => {
    if (!deps.items) return c.json({ rows: [], total: 0, unmapped: 0 });
    const all = (await deps.items.list()).filter((i) => i.status === "active");
    const rawQuery = (c.req.query("q") ?? "").trim();
    const q = rawQuery.toLowerCase();
    const unmappedOnly = c.req.query("unmapped") === "1";
    const matching = all.filter((i) => {
      if (unmappedOnly && !itemNeedsCode(i)) return false;
      if (q === "") return true;
      return (
        i.code.toLowerCase().includes(q) ||
        i.nameAr.includes(rawQuery) ||
        (i.nameEn ?? "").toLowerCase().includes(q)
      );
    });
    const rows = matching
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .slice(0, 200)
      .map((i) => ({
        itemId: i.id,
        code: i.code,
        nameAr: i.nameAr,
        nameEn: i.nameEn,
        etaCodeType: i.etaCodeType,
        etaItemCode: i.etaItemCode,
        gpcCode: i.gpcCode,
      }));
    return c.json({ rows, total: matching.length, unmapped: all.filter(itemNeedsCode).length });
  });

  app.put("/item-mappings/:itemId", gate("accounting.eta.submit"), async (c) => {
    if (!deps.items) return c.json({ error: "NOT_CONFIGURED" }, 404);
    const parsed = updateEtaItemMappingSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const itemId = c.req.param("itemId");
    const item = await deps.items.findById(itemId);
    if (!item) return c.json({ error: "ITEM_NOT_FOUND", message: `Item ${itemId} does not exist` }, 404);
    const patch = parsed.data;
    const next: Item = {
      ...item,
      etaCodeType: patch.etaCodeType !== undefined ? patch.etaCodeType : item.etaCodeType,
      etaItemCode: patch.etaItemCode !== undefined ? (patch.etaItemCode?.trim() || null) : item.etaItemCode,
      gpcCode: patch.gpcCode !== undefined ? (patch.gpcCode?.trim() || null) : item.gpcCode,
    };
    await deps.items.update(next);
    await recordFieldChanges(audit, c, {
      entity: { module: "inventory", entityType: "ITEM", entityId: next.id },
      action: AuditChangeAction.Update,
      before: item,
      after: next,
      fields: ["etaCodeType", "etaItemCode", "gpcCode"],
      severity: "WARNING",
      details: { code: next.code, nameAr: next.nameAr, source: "eta-item-mapping" },
    });
    return c.json({
      itemId: next.id,
      code: next.code,
      nameAr: next.nameAr,
      nameEn: next.nameEn,
      etaCodeType: next.etaCodeType,
      etaItemCode: next.etaItemCode,
      gpcCode: next.gpcCode,
    });
  });

  app.get("/unit-mappings", gate("accounting.eta.view"), async (c) => {
    if (!deps.units || !deps.unitMappings) return c.json([]);
    const [units, mappings] = await Promise.all([deps.units.list(), deps.unitMappings.list()]);
    const byCode = new Map(mappings.map((m) => [m.unitCode, m.etaUnitCode]));
    return c.json(
      units
        .filter((u) => u.status === "active")
        .map((u) => ({
          unitCode: u.code,
          nameAr: u.nameAr,
          nameEn: u.nameEn,
          etaUnitCode: byCode.get(u.code) ?? null,
          suggestion: suggestEtaUnitCode(u.code, u.nameAr),
        })),
    );
  });

  app.put("/unit-mappings/:unitCode", gate("accounting.eta.submit"), async (c) => {
    if (!deps.units || !deps.unitMappings) return c.json({ error: "NOT_CONFIGURED" }, 404);
    const parsed = updateEtaUnitMappingSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const unitCode = c.req.param("unitCode");
    const unit = await deps.units.findByCode(unitCode);
    if (!unit) return c.json({ error: "UNIT_NOT_FOUND", message: `Unit ${unitCode} does not exist` }, 404);
    const etaUnitCode = parsed.data.etaUnitCode.trim().toUpperCase();
    if (!isEtaUnitCode(etaUnitCode)) {
      return c.json({ error: "UNKNOWN_ETA_UNIT_CODE", message: `${etaUnitCode} is not an authority unit code` }, 400);
    }
    await deps.unitMappings.save({ unitCode: unit.code, etaUnitCode });
    return c.json({
      unitCode: unit.code,
      nameAr: unit.nameAr,
      nameEn: unit.nameEn,
      etaUnitCode,
      suggestion: suggestEtaUnitCode(unit.code, unit.nameAr),
    });
  });

  app.post("/unit-mappings/apply-suggestions", gate("accounting.eta.submit"), async (c) => {
    if (!deps.units || !deps.unitMappings) return c.json({ error: "NOT_CONFIGURED" }, 404);
    const [units, mappings] = await Promise.all([deps.units.list(), deps.unitMappings.list()]);
    const mapped = new Set(mappings.map((m) => m.unitCode));
    const applied: unknown[] = [];
    const unresolved: string[] = [];
    for (const unit of units.filter((u) => u.status === "active" && !mapped.has(u.code))) {
      const suggestion = suggestEtaUnitCode(unit.code, unit.nameAr);
      if (!suggestion) {
        unresolved.push(unit.code);
        continue;
      }
      await deps.unitMappings.save({ unitCode: unit.code, etaUnitCode: suggestion });
      applied.push({
        unitCode: unit.code,
        nameAr: unit.nameAr,
        nameEn: unit.nameEn,
        etaUnitCode: suggestion,
        suggestion,
      });
    }
    return c.json({ applied, unresolved });
  });

  app.get("/tax-subtypes", gate("accounting.eta.view"), async (c) => {
    if (!deps.taxRates) return c.json([]);
    const rates = await deps.taxRates.list();
    return c.json(
      rates
        .filter((r) => r.status === TaxRateStatusCode.Active)
        .map((r) => ({
          taxRateId: r.id,
          code: r.code,
          name: r.name,
          rate: r.rate,
          etaSubType: r.etaSubType,
          resolved: r.etaSubType !== EtaVatSubTypeCode.Auto,
        })),
    );
  });


  /**
   * الإيصال الإلكتروني — the B2C receipt surface. A receipt is REPORTED after
   * the sale, so these three routes are the offline path: issue (and print),
   * reprint, and see how much of the queue has aged past the window.
   */
  app.get("/receipts/summary", gate("accounting.eta.view"), async (c) => {
    return c.json(await service.receiptQueueSummary());
  });

  app.post("/receipts", gate("accounting.eta.submit"), async (c) => {
    const parsed = issueReceiptSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      // feesAmount is refused by omission: the SDK accepts only zero there.
      const { seller, feesAmount: _fees, ...rest } = parsed.data;
      const device = await resolveReceiptDevice(deps, seller.branchId);
      const printed = await service.enqueueReceipt({
        ...rest,
        seller: {
          deviceSerialNumber: device.deviceSerialNumber,
          branchCode: device.etaBranchCode,
          companyTradeName: deps.companyTradeName ? await deps.companyTradeName() : null,
          syndicateLicenseNumber: seller.syndicateLicenseNumber ?? null,
        },
      } as EtaChainedReceiptInput);
      return c.json({
        submission: serializeSubmission(printed.submission),
        receiptNo: printed.receiptNo,
        uuid: printed.uuid,
        qrValue: printed.qrValue,
      });
    } catch (err) {
      return handleError(c, err);
    }
  });

  /**
   * إيصالات لم تصدر — consumer sales and returns that should have a receipt and
   * have none, with the reason; and the action that issues one once the cause
   * (device, registration, buyer ID) is fixed.
   */
  app.get("/receipts/gaps", gate("accounting.eta.view"), async (c) => {
    return c.json(await service.listReceiptGaps());
  });

  app.post("/receipts/issue/:kind/:docId", gate("accounting.eta.submit"), async (c) => {
    const kind = parseEtaReceiptSourceKind(c.req.param("kind"));
    if (!kind) return c.json({ error: "NOT_FOUND" }, 404);
    if (!deps.issueDocumentReceipt) return c.json({ error: "NOT_CONFIGURED" }, 404);
    try {
      const printed = await deps.issueDocumentReceipt(kind, c.req.param("docId"));
      if (!printed) {
        return c.json(
          { error: "ETA_RECEIPT_NOT_APPLICABLE", message: "المستند غير مؤكد أو ليس بيعاً لمستهلك، فلا يصدر له إيصال." },
          422,
        );
      }
      return c.json(printed);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/receipts/reissue/:kind/:docId", gate("accounting.eta.submit"), async (c) => {
    const kind = parseEtaReceiptSourceKind(c.req.param("kind"));
    if (!kind) return c.json({ error: "NOT_FOUND" }, 404);
    if (!deps.reissueDocumentReceipt) return c.json({ error: "NOT_CONFIGURED" }, 404);
    try {
      const printed = await deps.reissueDocumentReceipt(kind, c.req.param("docId"));
      if (!printed) {
        return c.json(
          { error: "ETA_RECEIPT_NOT_APPLICABLE", message: "لا يوجد لهذا المستند إيصال رفضته المصلحة، فلا يوجد ما يُصحَّح." },
          422,
        );
      }
      return c.json(printed);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/receipts/:internalId", gate("accounting.eta.view"), async (c) => {
    const printed = await service.receiptForPrint(c.req.param("internalId"));
    if (!printed) {
      return c.json({ error: "ETA_SUBMISSION_NOT_FOUND", message: "لا يوجد إيصال إلكتروني بهذا الرقم." }, 404);
    }
    return c.json({
      submission: serializeSubmission(printed.submission, { payload: true }),
      receiptNo: printed.receiptNo,
      uuid: printed.uuid,
      qrValue: printed.qrValue,
    });
  });

  app.get("/submissions", gate("accounting.eta.view"), async (c) => {
    const status = c.req.query("status") as EtaSubmissionStatus | undefined;
    const submissions = await service.list(status);
    return c.json(submissions.map((s) => serializeSubmission(s)));
  });

  app.get("/submissions/:id", gate("accounting.eta.view"), async (c) => {
    const submission = await service.findById(c.req.param("id"));
    if (!submission) {
      return c.json({ error: "ETA_SUBMISSION_NOT_FOUND", message: `الإرسال \"${c.req.param("id")}\" غير موجود.` }, 404);
    }
    return c.json(serializeSubmission(submission, { payload: true }));
  });

  app.post("/submissions/:id/submit", gate("accounting.eta.submit"), async (c) => {
    try {
      return c.json(serializeSubmission(await service.submit(c.req.param("id"))));
    } catch (err) {
      return handleError(c, err);
    }
  });

  /**
   * معالجة قائمة الإرسال — one pass over the whole queue: sign and transmit
   * everything pending, then poll everything already transmitted for its
   * clearance or rejection. This is what a scheduler calls.
   */
  app.post("/submissions/process", gate("accounting.eta.submit"), async (c) => {
    const result = await service.processQueue();
    return c.json({
      submitted: result.submitted.map((s) => serializeSubmission(s)),
      accepted: result.accepted.map((s) => serializeSubmission(s)),
      rejected: result.rejected.map((s) => serializeSubmission(s)),
      queued: result.queued,
      unsigned: result.unsigned,
      blocked: result.blocked,
    });
  });

  app.post("/submissions/:id/refresh-status", gate("accounting.eta.submit"), async (c) => {
    try {
      return c.json(serializeSubmission(await service.refreshStatus(c.req.param("id"))));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/submissions/submit-all", gate("accounting.eta.submit"), async (c) => {
    const result = await service.submitAllReady();
    return c.json({ submitted: result.submitted.map((s) => serializeSubmission(s)), queued: result.queued, blocked: result.blocked });
  });

  app.post("/submissions/:id/accept", gate("accounting.eta.submit"), async (c) => {
    let body: { etaUuid?: string } = {};
    try {
      body = (await c.req.json()) as { etaUuid?: string };
    } catch {
      body = {};
    }
    if (!body.etaUuid) return c.json({ error: "VALIDATION_ERROR", message: "etaUuid required" }, 400);
    try {
      return c.json(serializeSubmission(await service.markAccepted(c.req.param("id"), body.etaUuid)));
    } catch (err) {
      return handleError(c, err);
    }
  });

  /**
   * إصلاح وإعادة الطابور (WF-04 step 4) — regenerate one submission's payload
   * and pre-validation after a fix. 404 when no rebuild path exists for this
   * document type (a receipt) or the source document no longer resolves.
   */
  app.post("/submissions/:id/requeue", gate("accounting.eta.submit"), async (c) => {
    if (!deps.rebuildSubmission) return c.json({ error: "NOT_CONFIGURED" }, 404);
    const submission = await service.findById(c.req.param("id"));
    if (!submission) {
      return c.json({ error: "ETA_SUBMISSION_NOT_FOUND", message: `الإرسال \"${c.req.param("id")}\" غير موجود.` }, 404);
    }
    const rebuilt = await deps.rebuildSubmission(submission);
    if (!rebuilt) {
      return c.json(
        {
          error: "ETA_REQUEUE_NOT_AVAILABLE",
          message: "لا يمكن إعادة بناء هذا المستند — تحقّق من أنه فاتورة أو إشعار قائم وأن العميل له رقم ضريبي.",
        },
        422,
      );
    }
    try {
      return c.json(serializeSubmission(await service.requeue(submission.id, rebuilt)));
    } catch (err) {
      return handleError(c, err);
    }
  });

  /**
   * إصلاح وإعادة الطابور جماعياً — requeue then submit every selected row.
   * Each id gets its own outcome so one still-broken document does not stop
   * the rest of the batch (WF-04 step 4 "select all and Bulk Resubmit").
   */
  app.post("/submissions/bulk-requeue-submit", gate("accounting.eta.submit"), async (c) => {
    const parsed = bulkRequeueSubmitSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const results: Array<{
      readonly id: string;
      readonly outcome: EtaBulkRequeueOutcome;
      readonly submission?: ReturnType<typeof serializeSubmission>;
      readonly message?: string;
    }> = [];
    for (const id of parsed.data.ids) {
      try {
        const submission = await service.findById(id);
        if (!submission) {
          results.push({ id, outcome: EtaBulkRequeueOutcome.Error, message: "الإرسال غير موجود." });
          continue;
        }
        if (deps.rebuildSubmission) {
          const rebuilt = await deps.rebuildSubmission(submission);
          if (rebuilt) await service.requeue(id, rebuilt);
        }
        const submitted = await service.submit(id);
        results.push({ id, outcome: EtaBulkRequeueOutcome.Submitted, submission: serializeSubmission(submitted) });
      } catch (err) {
        if (err instanceof EtaOfflineError || err instanceof EtaSubmissionInFlightError) {
          results.push({ id, outcome: EtaBulkRequeueOutcome.Queued, message: err.message });
        } else if (err instanceof EtaPrevalidationFailedError) {
          results.push({ id, outcome: EtaBulkRequeueOutcome.Blocked, message: err.message });
        } else if (err instanceof Error) {
          results.push({ id, outcome: EtaBulkRequeueOutcome.Error, message: err.message });
        } else {
          throw err;
        }
      }
    }
    return c.json({ results });
  });

  /** تقرير أسباب الرفض — grouped by the authority's own error code, with counts and example documents. */
  app.get("/reports/rejections", gate("accounting.eta.view"), async (c) => {
    return c.json(await service.rejectionsReport());
  });

  app.post("/submissions/:id/exclude", gate("accounting.eta.cancel"), async (c) => {
    const parsed = excludeEtaSubmissionSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeSubmission(await service.exclude(c.req.param("id"), parsed.data.reason)));
    } catch (err) {
      return handleError(c, err);
    }
  });

  return app;
}
