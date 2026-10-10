import { Hono, type Context } from "hono";
import {
  createTaxRate,
  updateTaxRate,
  DuplicateTaxCodeError,
  DuplicateTaxRateIdError,
  InvalidTaxRateError,
  TaxRateNotFoundError,
  TaxRateInUseError,
  SystemTaxRateLockedError,
  isSystemTaxRate,
  AuditChangeAction,
  type AuditSink,
  type TaxRate,
  type TaxRateRepository,
  type TaxRateUsage,
} from "@mezan/domain";
import { createTaxRateSchema, updateTaxRateSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { recordFieldChanges } from "./admin-audit.js";

const AUDITED_TAX_RATE_FIELDS = [
  "code",
  "name",
  "rate",
  "calculationType",
  "isDefault",
  "outputTaxAccountId",
  "inputTaxAccountId",
  "etaSubType",
  "status",
] as const;

function serialize(taxRate: TaxRate) {
  return {
    id: taxRate.id,
    code: taxRate.code,
    name: taxRate.name,
    rate: taxRate.rate,
    calculationType: taxRate.calculationType,
    isDefault: taxRate.isDefault,
    outputTaxAccountId: taxRate.outputTaxAccountId,
    inputTaxAccountId: taxRate.inputTaxAccountId,
    etaSubType: taxRate.etaSubType,
    status: taxRate.status,
    isSystem: isSystemTaxRate(taxRate.id),
  };
}

function handleDomainError(c: Context, err: unknown) {
  const refuse = (e: Error & { code: string; messageEn?: string }, status: 404 | 409 | 422) =>
    c.json({ error: e.code, message: e.message, ...(e.messageEn ? { messageEn: e.messageEn } : {}) }, status);
  if (err instanceof TaxRateNotFoundError) {
    return refuse(err, 404);
  }
  if (err instanceof DuplicateTaxCodeError || err instanceof DuplicateTaxRateIdError || err instanceof TaxRateInUseError || err instanceof SystemTaxRateLockedError) {
    return refuse(err, 409);
  }
  if (err instanceof InvalidTaxRateError) {
    return refuse(err, 422);
  }
  throw err;
}

/**
 * Tax rate routes (docs/archive/catalog/04 "الضرائب"): list, get one, create, edit.
 * Every route is permission-gated via `accounting.tax.view` / `.manage`,
 * matching the permission catalog's accounting module row 13.
 */
export function createTaxRatesRoutes(
  repo: TaxRateRepository,
  resolveAuthContext: AuthContextResolver,
  usage: TaxRateUsage,
  audit?: AuditSink,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("accounting.tax.view"), async (c) => {
    const taxRates = await repo.list();
    return c.json(taxRates.map(serialize));
  });

  app.get("/:id", gate("accounting.tax.view"), async (c) => {
    const taxRate = await repo.findById(c.req.param("id"));
    if (!taxRate) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(taxRate));
  });

  app.post("/", gate("accounting.tax.manage"), async (c) => {
    const parsed = createTaxRateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const taxRate = await createTaxRate(parsed.data, repo);
      await recordFieldChanges(audit, c, {
        entity: { module: "accounting", entityType: "TAX_RATE", entityId: taxRate.id },
        action: AuditChangeAction.Create,
        before: null,
        after: serialize(taxRate),
        fields: AUDITED_TAX_RATE_FIELDS,
      });
      return c.json(serialize(taxRate), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("accounting.tax.manage"), async (c) => {
    const parsed = updateTaxRateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const before = await repo.findById(c.req.param("id"));
      const taxRate = await updateTaxRate(c.req.param("id"), parsed.data, repo, usage);
      await recordFieldChanges(audit, c, {
        entity: { module: "accounting", entityType: "TAX_RATE", entityId: taxRate.id },
        action: AuditChangeAction.Update,
        before: before ? serialize(before) : null,
        after: serialize(taxRate),
        fields: AUDITED_TAX_RATE_FIELDS,
        warnOn: ["rate", "calculationType", "isDefault", "outputTaxAccountId", "inputTaxAccountId", "etaSubType", "status"],
      });
      return c.json(serialize(taxRate));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
