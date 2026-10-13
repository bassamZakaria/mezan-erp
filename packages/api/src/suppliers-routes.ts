import { postingRefusalResponse } from "./posting-refusal.js";
import { Hono, type Context } from "hono";
import { createSupplier, updateSupplier, InvalidSupplierError, Money, AuditChangeAction, type AuditSink, type Supplier, type SupplierRepository, matchesSearch } from "@mezan/domain";
import { nextMasterCode } from "./master-code.js";
import { createSupplierSchema, updateSupplierSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { recordFieldChanges } from "./admin-audit.js";
import type { PartyOpeningBalancePoster } from "./customers-routes.js";
import { tenantToday } from "./tenant-day.js";

/**
 * What is still owed to each supplier — the supplier aging ladder's row, which
 * carries the opening balance, confirmed purchase invoices at their base total,
 * payments, returns, cheques and manual journal lines. The composition root
 * MUST bind this to that ladder; a second opinion here would put the
 * suppliers list and the AP sub-ledger at odds.
 *
 * Optional because this module owns supplier master data only and has no
 * access to purchase invoices, vouchers, returns or cheques. Without it
 * `GET /stats` reports `payable: null` rather than reporting the opening
 * balance as the debt, which is what left every row at 0.00 against 150,867.60
 * of confirmed invoices (D39).
 */
export interface SupplierPayablesSource {
  /** `today` is the TENANT's calendar day, resolved at the route (D288). */
  outstandingBySupplier(today: string): Promise<ReadonlyMap<string, Money>>;
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
    bankAccount: supplier.bankAccount,
  };
}

export const AUDITED_SUPPLIER_FIELDS = [
  "code",
  "nameAr",
  "nameEn",
  "phone",
  "email",
  "contactPerson",
  "taxNumber",
  "category",
  "notes",
  "paymentTermsDays",
  "currency",
  "openingBalance",
  "active",
  "addressCity",
  "addressDistrict",
  "addressStreet",
  "bankAccount",
] as const;

function handleDomainError(c: Context, err: unknown) {
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof InvalidSupplierError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/**
 * Supplier routes (docs/archive/catalog/02 "الموردون"): list, get one, create, edit —
 * the mirror of customers-routes.ts. Every route is permission-gated via the
 * permissions engine (`purchases.supplier.view` / `.create` / `.edit`).
 * Balance-owed/statement rollups are Phase-2 (document) work — not exposed here.
 */
export function createSuppliersRouter(
  repo: SupplierRepository,
  resolveAuthContext: AuthContextResolver,
  payables?: SupplierPayablesSource,
  /**
   * The twin of the customer trail. A supplier's bank details and opening
   * balance decide where money goes and how much is owed; the customer side
   * was logged and this one was not.
   */
  audit?: AuditSink,
  /** Posts the supplier's رصيد افتتاحي into the ledger (Dr 3210 / Cr 2100) — see customers-routes.ts (B-2). */
  openingBalances?: PartyOpeningBalancePoster,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  function auditSupplier(c: Context, supplier: Supplier, action: AuditChangeAction, before?: Supplier) {
    return recordFieldChanges(audit, c, {
      entity: { module: "purchases", entityType: "SUPPLIER", entityId: supplier.id },
      action,
      before: before ? serialize(before) : null,
      after: serialize(supplier),
      fields: AUDITED_SUPPLIER_FIELDS,
      warnOn: ["openingBalance", "bankAccount", "taxNumber", "active"],
      details: { code: supplier.code, nameAr: supplier.nameAr },
    });
  }

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

  /**
   * What each supplier is owed, from the supplier aging ladder's own row —
   * opening balance, invoices at their base total, returns, payments and
   * cheques — so the screen never derives a second figure (D201).
   */
  async function withOwed(c: Context, rows: readonly Supplier[]) {
    const outstanding = payables ? await payables.outstandingBySupplier(await tenantToday(c)) : null;
    return rows.map((supplier) => ({
      ...serialize(supplier),
      owed: outstanding ? (outstanding.get(supplier.id) ?? Money.zero()).toString() : null,
    }));
  }

  app.get("/", gate("purchases.supplier.view"), async (c) => {
    return c.json(await withOwed(c, await listFilteredSuppliers(parseSupplierListQuery(c))));
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
    const outstanding = (await payables?.outstandingBySupplier(await tenantToday(c))) ?? new Map<string, Money>();
    let active = 0;
    let payable = Money.zero();
    for (const supplier of suppliers) {
      if (supplier.active) active += 1;
      payable = payable.add(outstanding.get(supplier.id) ?? Money.zero());
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
    const [row] = await withOwed(c, [supplier]);
    return c.json(row);
  });

  app.post("/", gate("purchases.supplier.create"), async (c) => {
    const parsed = createSupplierSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (await repo.findById(parsed.data.id)) {
      return c.json({ error: "ALREADY_EXISTS" }, 409);
    }
    const code = parsed.data.code ?? nextMasterCode((await repo.findAll()).map((row) => row.code), "S");
    if (await repo.findByCode(code)) {
      return c.json({ error: "DUPLICATE_SUPPLIER_CODE", message: `كود المورد «${code}» مستخدم بالفعل.` }, 409);
    }
    try {
      const { openingBalance, ...fields } = parsed.data;
      const rest = { ...fields, code };
      const supplier = createSupplier({
        ...rest,
        openingBalance: openingBalance !== undefined ? Money.fromMajor(openingBalance) : undefined,
      });
      // The GL post goes FIRST (matches customers-routes.ts): a refused
      // period must leave behind no supplier carrying a balance the control
      // account never heard about.
      await openingBalances?.post(supplier);
      await repo.save(supplier);
      await auditSupplier(c, supplier, AuditChangeAction.Create);
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
        return c.json({ error: "DUPLICATE_SUPPLIER_CODE", message: `كود المورد «${parsed.data.code}» مستخدم بالفعل.` }, 409);
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
      if (next.openingBalance.scaled !== current.openingBalance.scaled) {
        await openingBalances?.post(next);
      }
      await repo.save(next);
      await auditSupplier(c, next, AuditChangeAction.Update, current);
      return c.json(serialize(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
