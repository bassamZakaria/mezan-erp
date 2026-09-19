import { Hono } from "hono";
import { AuditChangeAction, type AuditSink, type ExchangeRate, type ExchangeRateRepository } from "@mezan/domain";
import { createExchangeRateSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { recordFieldChanges } from "./admin-audit.js";

const AUDITED_EXCHANGE_RATE_FIELDS = ["currency", "rate", "effectiveDate", "rateType", "source", "status"] as const;

function serialize(rate: ExchangeRate) {
  return {
    id: rate.id,
    currency: rate.currency,
    rate: rate.rate,
    effectiveDate: rate.effectiveDate,
    rateType: rate.rateType,
    source: rate.source,
    status: rate.status,
  };
}

/**
 * Exchange-rate routes (docs/archive/catalog/04 "أسعار الصرف"), mounted under
 * `/exchange-rates`: list, create, and the approval/lock lifecycle actions.
 * Permissions: `accounting.exchange_rate.manage` (view/create),
 * `accounting.exchange_rate.approve` (approve/lock).
 */
export function createExchangeRatesRoutes(
  repo: ExchangeRateRepository,
  resolveAuthContext: AuthContextResolver,
  audit?: AuditSink,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("accounting.exchange_rate.manage"), async (c) => {
    const rates = await repo.list();
    return c.json(rates.map(serialize));
  });

  app.post("/", gate("accounting.exchange_rate.manage"), async (c) => {
    const parsed = createExchangeRateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    // The repository upserts by id, so without this check re-POSTing an
    // existing id rewrote the rate and reset its status — an approved or even
    // LOCKED rate could be silently replaced through the create route (D25).
    if (await repo.findById(parsed.data.id)) {
      return c.json({ error: "ALREADY_EXISTS", message: "سعر صرف بهذا المعرّف موجود بالفعل." }, 409);
    }
    const rate: ExchangeRate = {
      id: parsed.data.id,
      currency: parsed.data.currency,
      rate: parsed.data.rate,
      effectiveDate: parsed.data.effectiveDate,
      rateType: parsed.data.rateType ?? "standard",
      source: parsed.data.source ?? "manual",
      status: parsed.data.status ?? "pending",
    };
    await repo.create(rate);
    await recordFieldChanges(audit, c, {
      entity: { module: "accounting", entityType: "EXCHANGE_RATE", entityId: rate.id },
      action: AuditChangeAction.Create,
      before: null,
      after: serialize(rate),
      fields: AUDITED_EXCHANGE_RATE_FIELDS,
    });
    return c.json(serialize(rate), 201);
  });

  app.post("/:id/approve", gate("accounting.exchange_rate.approve"), async (c) => {
    const rate = await repo.findById(c.req.param("id"));
    if (!rate) return c.json({ error: "NOT_FOUND" }, 404);
    // Locked is terminal, the same way a locked fiscal period is: approving
    // back down from it would undo the lock (D25).
    if (rate.status === "locked") {
      return c.json({ error: "RATE_LOCKED", message: "سعر الصرف مقفل ولا يمكن تعديل حالته." }, 409);
    }
    const next: ExchangeRate = { ...rate, status: "approved" };
    await repo.update(next);
    await recordFieldChanges(audit, c, {
      entity: { module: "accounting", entityType: "EXCHANGE_RATE", entityId: next.id },
      action: AuditChangeAction.Approve,
      before: serialize(rate),
      after: serialize(next),
      fields: AUDITED_EXCHANGE_RATE_FIELDS,
      severity: "WARNING",
    });
    return c.json(serialize(next));
  });

  app.post("/:id/lock", gate("accounting.exchange_rate.approve"), async (c) => {
    const rate = await repo.findById(c.req.param("id"));
    if (!rate) return c.json({ error: "NOT_FOUND" }, 404);
    const next: ExchangeRate = { ...rate, status: "locked" };
    await repo.update(next);
    await recordFieldChanges(audit, c, {
      entity: { module: "accounting", entityType: "EXCHANGE_RATE", entityId: next.id },
      action: AuditChangeAction.Lock,
      before: serialize(rate),
      after: serialize(next),
      fields: AUDITED_EXCHANGE_RATE_FIELDS,
      severity: "WARNING",
    });
    return c.json(serialize(next));
  });

  return app;
}
