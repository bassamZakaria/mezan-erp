import { Hono, type Context } from "hono";
import {
  Money,
  createPriceList,
  updatePriceList,
  DuplicatePriceListError,
  InvalidPriceListError,
  PriceListNotFoundError,
  type PriceList,
  type PriceListRepository,
} from "@mezan/domain";
import { createPriceListSchema, updatePriceListSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

function serialize(priceList: PriceList) {
  return {
    id: priceList.id,
    code: priceList.code,
    nameAr: priceList.nameAr,
    nameEn: priceList.nameEn,
    description: priceList.description,
    isBase: priceList.isBase,
    active: priceList.active,
    lines: priceList.lines.map((line) => ({ itemId: line.itemId, price: line.price.toString() })),
    createdAt: priceList.createdAt,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof PriceListNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicatePriceListError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidPriceListError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/**
 * Price list routes (docs/catalog/01 "قوائم الأسعار"): list, get one, create,
 * edit, activate/deactivate. Every route is permission-gated via
 * `sales.price_list.view` / `.manage`.
 */
export function createPriceListsRoutes(
  repo: PriceListRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("sales.price_list.view"), async (c) => {
    const activeParam = c.req.query("active");
    const filter = activeParam === undefined ? undefined : { active: activeParam === "true" };
    const priceLists = await repo.list(filter);
    return c.json(priceLists.map(serialize));
  });

  app.get("/:id", gate("sales.price_list.view"), async (c) => {
    const priceList = await repo.findById(c.req.param("id"));
    if (!priceList) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(priceList));
  });

  app.post("/", gate("sales.price_list.manage"), async (c) => {
    const parsed = createPriceListSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const existing = await repo.list();
      if (existing.some((pl) => pl.code === parsed.data.code)) {
        throw new DuplicatePriceListError(parsed.data.code);
      }
      const priceList = await createPriceList(
        {
          id: parsed.data.id ?? crypto.randomUUID(),
          code: parsed.data.code,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn,
          description: parsed.data.description,
          isBase: parsed.data.isBase,
          lines: parsed.data.lines?.map((line) => ({ itemId: line.itemId, price: Money.fromMajor(line.price) })),
        },
        repo,
      );
      return c.json(serialize(priceList), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("sales.price_list.manage"), async (c) => {
    const parsed = updatePriceListSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      if (parsed.data.code !== undefined) {
        const existing = await repo.list();
        if (existing.some((pl) => pl.code === parsed.data.code && pl.id !== c.req.param("id"))) {
          throw new DuplicatePriceListError(parsed.data.code);
        }
      }
      const priceList = await updatePriceList(
        c.req.param("id"),
        {
          code: parsed.data.code,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn,
          description: parsed.data.description,
          isBase: parsed.data.isBase,
          active: parsed.data.active,
          lines: parsed.data.lines?.map((line) => ({ itemId: line.itemId, price: Money.fromMajor(line.price) })),
        },
        repo,
      );
      return c.json(serialize(priceList));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/deactivate", gate("sales.price_list.manage"), async (c) => {
    try {
      const priceList = await updatePriceList(c.req.param("id"), { active: false }, repo);
      return c.json(serialize(priceList));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/activate", gate("sales.price_list.manage"), async (c) => {
    try {
      const priceList = await updatePriceList(c.req.param("id"), { active: true }, repo);
      return c.json(serialize(priceList));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
