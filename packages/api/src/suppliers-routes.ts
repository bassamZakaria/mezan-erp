import { Hono, type Context } from "hono";
import { createSupplier, updateSupplier, InvalidSupplierError, Money, type Supplier, type SupplierRepository } from "@mezan/domain";
import { createSupplierSchema, updateSupplierSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/** Wire representation of a supplier — a plain JSON-safe projection with Money as decimal strings. */
function serialize(supplier: Supplier) {
  return {
    id: supplier.id,
    code: supplier.code,
    nameAr: supplier.nameAr,
    nameEn: supplier.nameEn,
    phone: supplier.phone,
    email: supplier.email,
    contactPerson: supplier.contactPerson,
    taxNumber: supplier.taxNumber,
    category: supplier.category,
    notes: supplier.notes,
    paymentTermsDays: supplier.paymentTermsDays,
    currency: supplier.currency,
    openingBalance: supplier.openingBalance.toString(),
    active: supplier.active,
    addressCity: supplier.addressCity,
    addressDistrict: supplier.addressDistrict,
    addressStreet: supplier.addressStreet,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof InvalidSupplierError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/**
 * Supplier routes (docs/catalog/02 "الموردون"): list, get one, create, edit —
 * the mirror of customers-routes.ts. Every route is permission-gated via the
 * permissions engine (`purchases.supplier.view` / `.create` / `.edit`).
 * Balance-owed/statement rollups are Phase-2 (document) work — not exposed here.
 */
export function createSuppliersRouter(
  repo: SupplierRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("purchases.supplier.view"), async (c) => {
    const suppliers = await repo.findAll();
    return c.json(suppliers.map(serialize));
  });

  app.get("/:id", gate("purchases.supplier.view"), async (c) => {
    const supplier = await repo.findById(c.req.param("id"));
    if (!supplier) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(supplier));
  });

  app.post("/", gate("purchases.supplier.create"), async (c) => {
    const parsed = createSupplierSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (await repo.findById(parsed.data.id)) {
      return c.json({ error: "ALREADY_EXISTS" }, 409);
    }
    if (await repo.findByCode(parsed.data.code)) {
      return c.json({ error: "DUPLICATE_SUPPLIER_CODE", message: `Supplier code "${parsed.data.code}" already exists.` }, 409);
    }
    try {
      const { openingBalance, ...rest } = parsed.data;
      const supplier = createSupplier({
        ...rest,
        openingBalance: openingBalance !== undefined ? Money.fromMajor(openingBalance) : undefined,
      });
      await repo.save(supplier);
      return c.json(serialize(supplier), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("purchases.supplier.edit"), async (c) => {
    const id = c.req.param("id");
    const current = await repo.findById(id);
    if (!current) return c.json({ error: "NOT_FOUND" }, 404);

    const parsed = updateSupplierSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (parsed.data.code !== undefined && parsed.data.code !== current.code) {
      const clash = await repo.findByCode(parsed.data.code);
      if (clash) {
        return c.json({ error: "DUPLICATE_SUPPLIER_CODE", message: `Supplier code "${parsed.data.code}" already exists.` }, 409);
      }
    }
    try {
      // Only include openingBalance in the patch when the caller actually
      // supplied one — updateSupplier does a blind `{ ...current, ...patch }`
      // merge, so an explicit `undefined` value would clobber it instead of
      // leaving it untouched.
      const { openingBalance, ...rest } = parsed.data;
      const patch: Parameters<typeof updateSupplier>[1] = {
        ...rest,
        ...(openingBalance !== undefined ? { openingBalance: Money.fromMajor(openingBalance) } : {}),
      };
      const next = updateSupplier(current, patch);
      await repo.save(next);
      return c.json(serialize(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
