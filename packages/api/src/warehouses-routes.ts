import { Hono } from "hono";
import { ALL_SCOPE, createWarehouse, updateWarehouse, InvalidWarehouseError, type WarehouseRepository } from "@mezan/domain";
import { createWarehouseSchema, updateWarehouseSchema } from "@mezan/contracts";
import { branchGrantOf, createAuthenticatedGate, createPermissionGate, getAuthContext, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";
import { refuseExistingId } from "./duplicate-id.js";

export interface WarehouseUse {
  readonly holdsStock: boolean;
  readonly openDocuments: number;
}

export enum WarehouseRefusalCode {
  InUse = "WAREHOUSE_IN_USE",
}

function inUseRefusal(use: WarehouseUse): { error: WarehouseRefusalCode; message: string; messageEn: string } | null {
  if (!use.holdsStock && use.openDocuments === 0) return null;
  const reasons = [use.holdsStock ? "به رصيد مخزون" : null, use.openDocuments > 0 ? `عليه ${use.openDocuments} مستند لم يُرحَّل بعد` : null].filter((reason) => reason !== null);
  return {
    error: WarehouseRefusalCode.InUse,
    message: `لا يمكن نقل المستودع إلى فرع آخر: ${reasons.join("، و")}. صفِّ الرصيد ورحِّل المستندات المفتوحة أو ألغِها أولاً.`,
    messageEn: "The warehouse cannot be moved to another branch while it holds stock or has documents that are not yet posted.",
  };
}

/** Warehouse CRUD routes (docs/archive/catalog/09 §"إدارة المستودعات"), gated by admin.warehouses.*. */
export function createWarehousesRoutes(
  store: WarehouseRepository,
  resolveAuthContext: AuthContextResolver,
  useOf?: (warehouseId: string) => WarehouseUse,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.warehouses.view"), async (c) => {
    const branchId = c.req.query("branchId");
    const warehouses = branchId ? await store.findByBranch(branchId) : await store.findAll();
    return c.json(withinScope(warehouses, branchScopeOf(c), (w) => w.branchId));
  });

  /**
   * The warehouses a picker may offer: those of the branches and warehouses
   * the SESSION was granted. Any signed-in user may ask — a document that
   * takes a warehouse needs the list, and `admin.warehouses.view` would hand
   * a branch's clerk every other branch's store.
   *
   * Registered before `/:id`, which would otherwise read `lookup` as an id.
   */
  app.get("/lookup", createAuthenticatedGate(resolveAuthContext), async (c) => {
    const branches = branchGrantOf(c);
    const granted = getAuthContext(c)?.warehouseGrant;
    const warehouses = (await store.findAll())
      .filter((warehouse) => !branches || branches.includes(warehouse.branchId))
      .filter((warehouse) => !granted || granted === ALL_SCOPE || granted.includes(warehouse.id))
      .map((warehouse) => ({
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        nameEn: warehouse.nameEn,
        branchId: warehouse.branchId,
        type: warehouse.type,
        isDefault: warehouse.isDefault,
        active: warehouse.active,
      }));
    return c.json(warehouses);
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
    const taken = refuseExistingId(c, await store.findById(parsed.data.id), parsed.data.id);
    if (taken) return taken;
    const limit = c.get("entitlements")?.limits?.warehouses;
    if (limit !== undefined && (await store.findAll()).length >= limit) {
      return c.json(
        { error: "WAREHOUSE_LIMIT_REACHED", message: "وصلتم إلى الحد الأقصى للمستودعات في باقتكم" },
        409,
      );
    }
    try {
      const warehouse = createWarehouse(parsed.data);
      await store.insert(warehouse);
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
      // LEDGER INVARIANT: a warehouse's stock and unposted documents belong to
      // its branch. Re-homing it under them makes that pairing false in storage.
      const rehomed = next.branchId !== current.branchId && useOf ? inUseRefusal(useOf(id)) : null;
      if (rehomed) return c.json(rehomed, 409);
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
