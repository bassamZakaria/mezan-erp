import { Hono } from "hono";
import { createWarehouse, updateWarehouse, InvalidWarehouseError, type WarehouseRepository } from "@mezan/domain";
import { createWarehouseSchema, updateWarehouseSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";

/** Warehouse CRUD routes (docs/catalog/09 §"إدارة المستودعات"), gated by admin.warehouses.*. */
export function createWarehousesRoutes(
  store: WarehouseRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.warehouses.view"), async (c) => {
    const branchId = c.req.query("branchId");
    const warehouses = branchId ? await store.findByBranch(branchId) : await store.findAll();
    return c.json(withinScope(warehouses, branchScopeOf(c), (w) => w.branchId));
  });

  app.get("/:id", gate("admin.warehouses.view"), async (c) => {
    const warehouse = await store.findById(c.req.param("id"));
    if (!warehouse) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(warehouse);
  });

  app.post("/", gate("admin.warehouses.create"), async (c) => {
    const parsed = createWarehouseSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (await store.findById(parsed.data.id)) {
      return c.json({ error: "ALREADY_EXISTS" }, 409);
    }
    try {
      const warehouse = createWarehouse(parsed.data);
      await store.save(warehouse);
      return c.json(warehouse, 201);
    } catch (err) {
      if (err instanceof InvalidWarehouseError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      throw err;
    }
  });

  app.put("/:id", gate("admin.warehouses.edit"), async (c) => {
    const id = c.req.param("id");
    const current = await store.findById(id);
    if (!current) return c.json({ error: "NOT_FOUND" }, 404);

    const parsed = updateWarehouseSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const next = updateWarehouse(current, parsed.data);
      await store.save(next);
      return c.json(next);
    } catch (err) {
      if (err instanceof InvalidWarehouseError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      throw err;
    }
  });

  return app;
}
