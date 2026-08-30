import { Hono } from "hono";
import {
  taxGroupBreakdown,
  validateTaxGroup,
  InvalidTaxGroupError,
  type TaxGroup,
  type TaxGroupRepository,
  type TaxRateRepository,
} from "@mezan/domain";
import { upsertTaxGroupSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * مجموعات الضرائب (R6.4), mounted at `/tax-groups`.
 *
 * The response carries the per-member breakdown, not just a combined
 * percentage: the whole reason a group exists is that its parts are owed to
 * different authorities, and a VAT return cannot be produced from a figure
 * with two taxes melted into it.
 */
export function createTaxGroupsRoutes(
  repo: TaxGroupRepository,
  rates: Pick<TaxRateRepository, "list">,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function serialize(group: TaxGroup) {
    const all = await rates.list();
    const byId = new Map(all.map((rate) => [rate.id, { id: rate.id, ratePercent: rate.rate }]));
    const breakdown = taxGroupBreakdown(group, (id) => byId.get(id) ?? null);
    return {
      id: group.id,
      code: group.code,
      nameAr: group.nameAr,
      nameEn: group.nameEn,
      members: group.members,
      status: group.status,
      components: breakdown.components,
      effectivePercent: breakdown.effectivePercent,
    };
  }

  app.get("/", gate("accounting.tax.view"), async (c) => {
    const groups = await repo.list();
    return c.json(await Promise.all(groups.map(serialize)));
  });

  app.get("/:id", gate("accounting.tax.view"), async (c) => {
    const group = await repo.findById(c.req.param("id"));
    if (!group) return c.json({ error: "TAX_GROUP_NOT_FOUND" }, 404);
    return c.json(await serialize(group));
  });

  app.post("/", gate("accounting.tax.manage"), async (c) => {
    const parsed = upsertTaxGroupSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    if (await repo.findById(parsed.data.id)) return c.json({ error: "ALREADY_EXISTS" }, 409);
    const group: TaxGroup = {
      ...parsed.data,
      nameEn: parsed.data.nameEn ?? null,
      status: parsed.data.status ?? "active",
    };
    try {
      validateTaxGroup(group);
    } catch (err) {
      if (err instanceof InvalidTaxGroupError) return c.json({ error: err.code, message: err.message }, 422);
      throw err;
    }
    // Every member must be a real tax rate: a group pointing at a rate that
    // does not exist charges silently less than it claims to.
    const known = new Set((await rates.list()).map((rate) => rate.id));
    const missing = group.members.filter((member) => !known.has(member.taxRateId));
    if (missing.length > 0) {
      return c.json(
        { error: "TAX_RATE_NOT_FOUND", message: `Unknown tax rates: ${missing.map((m) => m.taxRateId).join(", ")}` },
        422,
      );
    }
    await repo.create(group);
    return c.json(await serialize(group), 201);
  });

  app.put("/:id", gate("accounting.tax.manage"), async (c) => {
    const existing = await repo.findById(c.req.param("id"));
    if (!existing) return c.json({ error: "TAX_GROUP_NOT_FOUND" }, 404);
    const parsed = upsertTaxGroupSchema.safeParse({ ...(await c.req.json()), id: c.req.param("id") });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const group: TaxGroup = {
      ...parsed.data,
      nameEn: parsed.data.nameEn ?? null,
      status: parsed.data.status ?? existing.status,
    };
    try {
      validateTaxGroup(group);
    } catch (err) {
      if (err instanceof InvalidTaxGroupError) return c.json({ error: err.code, message: err.message }, 422);
      throw err;
    }
    await repo.update(group);
    return c.json(await serialize(group));
  });

  return app;
}
