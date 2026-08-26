import { Hono, type Context } from "hono";
import { createSupplier, updateSupplier, InvalidSupplierError, Money, type Supplier, type SupplierRepository, matchesSearch } from "@mezan/domain";
import { createSupplierSchema, updateSupplierSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * What is still owed to each supplier on their LIVE documents — confirmed
 * purchase invoices, less payments made to them, confirmed returns sent back
 * and cheques already handed over. The composition root MUST bind this to the
 * same derivation the supplier statement tab uses; a second opinion here would
 * put the suppliers list and the AP sub-ledger at odds.
 *
 * Optional because this module owns supplier master data only and has no
 * access to purchase invoices, vouchers, returns or cheques. Without it
 * `GET /stats` reports `payable: null` rather than reporting the opening
 * balance as the debt, which is what left every row at 0.00 against 150,867.60
 * of confirmed invoices (D39).
 */
export interface SupplierPayablesSource {
  outstandingBySupplier(): Promise<ReadonlyMap<string, Money>>;
}

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
  payables?: SupplierPayablesSource,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  interface SupplierListFilter {
    readonly status?: string;
    readonly q?: string;
  }

  function parseSupplierListQuery(c: Context): SupplierListFilter {
    return { status: c.req.query("status") || undefined, q: c.req.query("q") || undefined };
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through. The screen used to narrow by status and free text in the browser
   * while its three tiles were totalled over every supplier the server had
   * sent, so applying a filter moved the rows and left the header alone.
   */
  async function listFilteredSuppliers(filter: SupplierListFilter): Promise<readonly Supplier[]> {
    let rows: readonly Supplier[] = await repo.findAll();
    if (filter.status === "active") rows = rows.filter((supplier) => supplier.active);
    else if (filter.status === "inactive") rows = rows.filter((supplier) => !supplier.active);
    if (filter.q) {
      rows = rows.filter((supplier) =>
        matchesSearch(filter.q, supplier.nameAr, supplier.nameEn, supplier.code, supplier.phone, supplier.email),
      );
    }
    return rows;
  }

  app.get("/", gate("purchases.supplier.view"), async (c) => {
    return c.json((await listFilteredSuppliers(parseSupplierListQuery(c))).map(serialize));
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   * Every other filter still applies.
   */
  app.get("/counts", gate("purchases.supplier.view"), async (c) => {
    const { status: _ignored, ...withoutStatus } = parseSupplierListQuery(c);
    const suppliers = await listFilteredSuppliers(withoutStatus);
    let active = 0;
    for (const supplier of suppliers) if (supplier.active) active += 1;
    return c.json({ all: suppliers.length, active, inactive: suppliers.length - active });
  });

  /**
   * The KPI strip. Money is summed here, in `Money`, over the whole filtered
   * set — the screen used to add JS numbers across the rows it happened to
   * hold, which both drifted and ignored the filters the user had applied.
   */
  app.get("/stats", gate("purchases.supplier.view"), async (c) => {
    const suppliers = await listFilteredSuppliers(parseSupplierListQuery(c));
    const outstanding = (await payables?.outstandingBySupplier()) ?? new Map<string, Money>();
    let active = 0;
    let payable = Money.zero();
    for (const supplier of suppliers) {
      if (supplier.active) active += 1;
      payable = payable.add(supplier.openingBalance).add(outstanding.get(supplier.id) ?? Money.zero());
    }
    return c.json({
      count: suppliers.length,
      active,
      payable: payables ? payable.toString() : null,
    });
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
