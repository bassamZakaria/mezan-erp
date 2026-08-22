import { Hono } from "hono";
import type { ExchangeRate, ExchangeRateRepository } from "@mezan/domain";
import { createExchangeRateSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

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
 * Exchange-rate routes (docs/catalog/04 "أسعار الصرف"), mounted under
 * `/exchange-rates`: list, create, and the approval/lock lifecycle actions.
 * Permissions: `accounting.exchange_rate.manage` (view/create),
 * `accounting.exchange_rate.approve` (approve/lock).
 */
export function createExchangeRatesRoutes(
  repo: ExchangeRateRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
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
    return c.json(serialize(rate), 201);
  });

  app.post("/:id/approve", gate("accounting.exchange_rate.approve"), async (c) => {
    const rate = await repo.findById(c.req.param("id"));
    if (!rate) return c.json({ error: "NOT_FOUND" }, 404);
    const next: ExchangeRate = { ...rate, status: "approved" };
    await repo.update(next);
    return c.json(serialize(next));
  });

  app.post("/:id/lock", gate("accounting.exchange_rate.approve"), async (c) => {
    const rate = await repo.findById(c.req.param("id"));
    if (!rate) return c.json({ error: "NOT_FOUND" }, 404);
    const next: ExchangeRate = { ...rate, status: "locked" };
    await repo.update(next);
    return c.json(serialize(next));
  });

  return app;
}
