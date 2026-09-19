import { Hono, type Context } from "hono";
import { z } from "zod";
import {
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
  EtaOfflineError,
  EtaReceiptUuidUnavailableError,
  EtaSignerNotConfiguredError,
  EtaSigningFailedError,
  EtaSubmissionNotFoundError,
  InvalidEtaTransitionError,
  type EtaBranchCodeRepository,
  type EtaConfig,
  type EtaReadinessCounts,
  type EtaReceiptInput,
  type EtaSubmission,
  type EtaSubmissionStatus,
  type EtaUnitMappingRepository,
  type Item,
  type ItemRepository,
  type ItemUnitRepository,
  type BranchRepository,
  type TaxRateRepository,
} from "@mezan/domain";
import {
  updateEtaConfigSchema,
  excludeEtaSubmissionSchema,
  updateEtaBranchCodeSchema,
  updateEtaItemMappingSchema,
  updateEtaUnitMappingSchema,
} from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

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
    taxRatesMissingSubType: taxRates.filter((t) => t.status === "active" && t.etaSubType === "auto").length,
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
  return {
    ...(opts.payload ? { payload: s.payload, transmitLog: s.transmitLog } : {}),
    id: s.id,
    internalId: s.internalId,
    documentType: s.documentType,
    status: s.status,
    etaUuid: s.etaUuid,
    errors: s.errors,
    exclusionReason: s.exclusionReason,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    submittedAt: s.submittedAt,
    gatewaySubmissionId: s.gatewaySubmissionId,
    signed: s.signature !== null,
  };
}

function handleError(c: Context, err: unknown): Response {
  if (err instanceof EtaSubmissionNotFoundError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 404);
  }
  if (err instanceof DuplicateEtaSubmissionError) {
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
  if (err instanceof EtaDeviceSerialNotRegisteredError) return c.json({ error: err.code, message: err.message }, 409);
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
  previousUuid: z.string().nullable().default(null),
  currency: z.string().optional(),
  exchangeRate: AMOUNT.optional(),
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
  paymentMethod: z.enum(["cash", "card", "wallet", "transfer", "other"]),
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
 *   GET  /receipts/:internalId         إعادة طباعة — the stored UUID and QR
 * Permissions: eta.view (reads), eta.submit (config write + submit), eta.cancel (exclude).
 */
export function createEtaRoutes(
  deps: EtaRoutesDeps,
  resolveAuthContext: AuthContextResolver,
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
    const { posClientSecret, ...patch } = parsed.data;
    const etaBranchCode = patch.etaBranchCode.trim();
    const deviceSerialNumber =
      patch.deviceSerialNumber !== undefined
        ? (patch.deviceSerialNumber?.trim() || null)
        : (current?.deviceSerialNumber ?? null);
    const posClientId =
      patch.posClientId !== undefined ? (patch.posClientId?.trim() || null) : (current?.posClientId ?? null);
    await deps.branchCodes.save({
      branchId,
      etaBranchCode,
      deviceSerialNumber,
      posClientId,
      hasPosClientSecret: current?.hasPosClientSecret ?? false,
    });
    if (posClientSecret) await deps.branchCodes.setPosClientSecret(branchId, posClientSecret);
    return c.json({
      branchId,
      branchCode: branch.code,
      branchName: branch.name,
      etaBranchCode,
      deviceSerialNumber,
      posClientId,
      hasPosClientSecret: !!posClientSecret || (current?.hasPosClientSecret ?? false),
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
        .filter((r) => r.status === "active")
        .map((r) => ({
          taxRateId: r.id,
          code: r.code,
          name: r.name,
          rate: r.rate,
          etaSubType: r.etaSubType,
          resolved: r.etaSubType !== "auto",
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
      const { seller, ...rest } = parsed.data;
      const device = await resolveReceiptDevice(deps, seller.branchId);
      const printed = await service.enqueueReceipt({
        ...rest,
        seller: {
          deviceSerialNumber: device.deviceSerialNumber,
          branchCode: device.etaBranchCode,
          syndicateLicenseNumber: seller.syndicateLicenseNumber ?? null,
        },
      } as EtaReceiptInput);
      return c.json({
        submission: serializeSubmission(printed.submission),
        uuid: printed.uuid,
        qrValue: printed.qrValue,
      });
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
    return c.json({ submitted: result.submitted.map((s) => serializeSubmission(s)), queued: result.queued });
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
