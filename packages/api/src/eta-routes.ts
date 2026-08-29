import { Hono, type Context } from "hono";
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
  EtaOfflineError,
  EtaSubmissionNotFoundError,
  InvalidEtaTransitionError,
  type EtaBranchCodeRepository,
  type EtaConfig,
  type EtaReadinessCounts,
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
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

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
    },
    readiness: computeEtaReadiness(config, counts),
  };
}

function serializeSubmission(s: EtaSubmission) {
  return {
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
  };
}

function handleError(c: Context, err: unknown): Response {
  if (err instanceof EtaSubmissionNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
  if (err instanceof DuplicateEtaSubmissionError) return c.json({ error: err.code, message: err.message }, 409);
  if (err instanceof InvalidEtaTransitionError) return c.json({ error: err.code, message: err.message }, 422);
  if (err instanceof EtaExclusionReasonRequiredError) return c.json({ error: err.code, message: err.message }, 400);
  // The stubbed online transmit refusing offline is an expected, non-fatal state.
  if (err instanceof EtaOfflineError) return c.json({ error: err.code, message: err.message }, 202);
  throw err;
}

/**
 * الفاتورة الإلكترونية (ETA) routes (docs/archive/catalog/04), mounted under `/eta`:
 *   GET  /config                       config + readiness
 *   PUT  /config                       update config (clientSecret stored, never returned)
 *   GET  /submissions[?status=]        the submission queue
 *   POST /submissions/:id/submit       submit one (online transmit is STUBBED)
 *   POST /submissions/submit-all       إرسال كل الجاهز
 *   POST /submissions/:id/accept       authority acceptance callback (demo/testing)
 *   POST /submissions/:id/exclude      مستبعد (reason required)
 *   GET  /activity-codes[?q=]          كود النشاط lookup
 *   GET  /unit-codes                   the authority's unit-of-measure codes
 *   POST /test-connection              اختبار الاتصال (credentials check; transmit is STUBBED)
 *   GET  /branch-codes                 أكواد الفروع لدى المصلحة
 *   PUT  /branch-codes/:branchId       register one branch's code
 *   GET  /item-mappings[?unmapped=1&q=] ربط الأصناف
 *   PUT  /item-mappings/:itemId        set an item's EGS/GPC codes
 *   GET  /unit-mappings                ربط الوحدات
 *   PUT  /unit-mappings/:unitCode      map one unit
 *   POST /unit-mappings/apply-suggestions تطبيق الاقتراحات
 *   GET  /tax-subtypes                 أنواع الضريبة الفرعية per tax rate
 * Permissions: eta.view (reads), eta.submit (config write + submit), eta.cancel (exclude).
 */
export function createEtaRoutes(
  deps: EtaRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
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
   * اختبار الاتصال — the credentials check. Transmission itself is stubbed
   * (see stubOnlineTransmitPort), so this reports honestly that the credentials
   * are on file and the gateway unreachable rather than faking a handshake.
   */
  app.post("/test-connection", gate("accounting.eta.submit"), async (c) => {
    const config = await service.getConfig();
    const hasCredentials = !!config.clientId && config.hasClientSecret;
    return c.json({
      ok: false,
      reason: hasCredentials ? "offline" : "missing_credentials",
      checkedAt: new Date().toISOString(),
    });
  });

  app.get("/branch-codes", gate("accounting.eta.view"), async (c) => {
    if (!deps.branches || !deps.branchCodes) return c.json([]);
    const [branches, codes] = await Promise.all([deps.branches.findAll(), deps.branchCodes.list()]);
    const byId = new Map(codes.map((m) => [m.branchId, m.etaBranchCode]));
    return c.json(
      branches
        .filter((b) => b.active)
        .map((b) => ({
          branchId: b.id,
          branchCode: b.code,
          branchName: b.name,
          etaBranchCode: byId.get(b.id) ?? null,
        })),
    );
  });

  app.put("/branch-codes/:branchId", gate("accounting.eta.submit"), async (c) => {
    if (!deps.branches || !deps.branchCodes) return c.json({ error: "NOT_CONFIGURED" }, 404);
    const parsed = updateEtaBranchCodeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const branchId = c.req.param("branchId");
    const branch = await deps.branches.findById(branchId);
    if (!branch) return c.json({ error: "BRANCH_NOT_FOUND", message: `Branch ${branchId} does not exist` }, 404);
    const etaBranchCode = parsed.data.etaBranchCode.trim();
    await deps.branchCodes.save({ branchId, etaBranchCode });
    return c.json({ branchId, branchCode: branch.code, branchName: branch.name, etaBranchCode });
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


  app.get("/submissions", gate("accounting.eta.view"), async (c) => {
    const status = c.req.query("status") as EtaSubmissionStatus | undefined;
    const submissions = await service.list(status);
    return c.json(submissions.map(serializeSubmission));
  });

  app.post("/submissions/:id/submit", gate("accounting.eta.submit"), async (c) => {
    try {
      return c.json(serializeSubmission(await service.submit(c.req.param("id"))));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/submissions/submit-all", gate("accounting.eta.submit"), async (c) => {
    const result = await service.submitAllReady();
    return c.json({ submitted: result.submitted.map(serializeSubmission), queued: result.queued });
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
