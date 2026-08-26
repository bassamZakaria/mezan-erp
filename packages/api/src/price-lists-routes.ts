import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  createPriceList,
  updatePriceList,
  resolvePrice,
  resolvePriceTier,
  DuplicatePriceListError,
  InvalidPriceListError,
  PriceListNotFoundError,
  type PriceList,
  type PriceListLine,
  type PriceListRepository,
} from "@mezan/domain";
import {
  createPriceListSchema,
  updatePriceListSchema,
  resolvePriceListPriceSchema,
  type PriceListLineDTO,
} from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/** Resolves a customer's assigned price list, so the resolve route can answer by customer as well as by list. */
export interface PriceListCustomerLookup {
  findById(id: string): Promise<{ priceListId: string | null } | null>;
}

function toDomainLine(line: PriceListLineDTO): PriceListLine {
  return {
    itemId: line.itemId,
    unitCode: line.unitCode ?? null,
    minQty: Qty.fromMajor(line.minQty ?? "0"),
    price: Money.fromMajor(line.price),
  };
}

function serialize(priceList: PriceList) {
  return {
    id: priceList.id,
    code: priceList.code,
    nameAr: priceList.nameAr,
    nameEn: priceList.nameEn,
    description: priceList.description,
    isBase: priceList.isBase,
    active: priceList.active,
    lines: priceList.lines.map((line) => ({
      itemId: line.itemId,
      unitCode: line.unitCode,
      minQty: line.minQty.toString(),
      price: line.price.toString(),
    })),
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
  customers?: PriceListCustomerLookup,
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

  /**
   * Applies a price list to a line (docs/catalog/01 §"قوائم الأسعار" —
   * per-customer/category sell prices). Thin wrapper around the pure
   * `resolvePrice` domain function: the MINIMUM-QUANTITY tier the line's `qty`
   * reaches if the list is active and quotes one, else `fallback` (the item's
   * normal sale price).
   *
   * `customerId` resolves the customer's own list here rather than in the
   * browser — a screen that picked the list itself would be free to pick the
   * wrong one, and the tier the invoice is measured against on confirm is the
   * one this route returns.
   */
  app.post("/resolve-price", gate("sales.price_list.view"), async (c) => {
    const parsed = resolvePriceListPriceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const { priceListId, customerId, itemId, fallback } = parsed.data;
    const qty = Qty.fromMajor(parsed.data.qty ?? "1");
    const resolvedListId =
      priceListId ?? (customerId && customers ? ((await customers.findById(customerId))?.priceListId ?? null) : null);
    const priceList = resolvedListId ? await repo.findById(resolvedListId) : null;
    const tier = resolvePriceTier(priceList, itemId, qty);
    return c.json({
      price: resolvePrice(priceList, itemId, Money.fromMajor(fallback), qty).toString(),
      priceListId: priceList?.id ?? null,
      tierMinQty: tier ? tier.minQty.toString() : null,
      fromPriceList: tier !== null,
    });
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
          lines: parsed.data.lines?.map(toDomainLine),
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
          lines: parsed.data.lines?.map(toDomainLine),
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
