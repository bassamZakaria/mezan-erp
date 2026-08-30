import { Hono, type Context } from "hono";
import {
  createItemSpecification,
  updateItemSpecification,
  deleteItemSpecification,
  DuplicateItemSpecificationCodeError,
  ItemSpecificationNotFoundError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
  type ItemSpecification,
  type ItemSpecificationRepository,
  type ItemSpecificationUsageCounter,
} from "@mezan/domain";
import { createItemSpecificationSchema, updateItemSpecificationSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * المواصفات — the reusable specification/attribute registry, mounted at
 * `/item-specifications`. Item master data like `/item-units` and
 * `/item-categories`, so it reuses the item permissions (`inventory.item.view`
 * to read, `.create` / `.edit` to write) rather than introducing new codes.
 * Nothing is seeded: an empty registry is a real, correct state for a tenant.
 */

export interface ItemSpecificationsRoutesDeps {
  readonly repo: ItemSpecificationRepository;
  /** Counts what binds to a specification — drives the الاستخدام column and the delete guard. */
  readonly usage: ItemSpecificationUsageCounter;
  readonly resolveAuthContext?: AuthContextResolver;
}

function serialize(specification: ItemSpecification, usageCount: number) {
  return {
    code: specification.code,
    nameAr: specification.nameAr,
    nameEn: specification.nameEn,
    type: specification.type,
    values: specification.values,
    unit: specification.unit,
    filterable: specification.filterable,
    status: specification.status,
    usageCount,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof ItemSpecificationNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateItemSpecificationCodeError || err instanceof ItemSpecificationInUseError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidItemSpecificationError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

export function createItemSpecificationsRoutes(
  deps: ItemSpecificationsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => {
    const specifications = await deps.repo.list();
    const rows = await Promise.all(
      specifications.map(async (specification) =>
        serialize(specification, await deps.usage.count(specification.code)),
      ),
    );
    return c.json(rows);
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createItemSpecificationSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const specification = await createItemSpecification(parsed.data, deps.repo);
      return c.json(serialize(specification, 0), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:code", gate("inventory.item.edit"), async (c) => {
    const parsed = updateItemSpecificationSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const specification = await updateItemSpecification(c.req.param("code"), parsed.data, deps.repo);
      return c.json(serialize(specification, await deps.usage.count(specification.code)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:code", gate("inventory.item.edit"), async (c) => {
    try {
      await deleteItemSpecification(c.req.param("code"), deps.repo, deps.usage);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
