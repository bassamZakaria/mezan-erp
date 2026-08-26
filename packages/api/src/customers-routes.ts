import { Hono, type Context } from "hono";
import {
  createCustomer,
  updateCustomer,
  InvalidCustomerError,
  matchesSearch,
  Money,
  recordSensitiveEvent,
  type AuditSink,
  type Customer,
  type CustomerRepository,
} from "@mezan/domain";
import { createCustomerSchema, updateCustomerSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/** Wire representation of a customer — a plain JSON-safe projection with Money as decimal strings. */
function serialize(customer: Customer) {
  return {
    id: customer.id,
    code: customer.code,
    nameAr: customer.nameAr,
    nameEn: customer.nameEn,
    phone: customer.phone,
    email: customer.email,
    contactPerson: customer.contactPerson,
    taxNumber: customer.taxNumber,
    category: customer.category,
    notes: customer.notes,
    paymentTermsDays: customer.paymentTermsDays,
    currency: customer.currency,
    openingBalance: customer.openingBalance.toString(),
    active: customer.active,
    priceListId: customer.priceListId,
    creditLimit: customer.creditLimit.toString(),
    taxExempt: customer.taxExempt,
    etaBuyerType: customer.etaBuyerType,
    nationalId: customer.nationalId,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof InvalidCustomerError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/**
 * Customer routes (docs/catalog/01 "العملاء"): list, get one, create, edit.
 * Every route is permission-gated via the permissions engine
 * (`sales.customer.view` / `sales.customer.create` / `sales.customer.edit`).
 * Statement/balance rollups are Phase-2 (document) work — not exposed here.
 */
export function createCustomersRouter(
  repo: CustomerRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  audit?: AuditSink,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  /**
   * A customer's own trail. The credit limit is the reason this matters: it is
   * the one master-data field that decides how much a salesperson may sell on
   * credit, and raising it quietly is the cheapest way to push a bad debt
   * through. `details` records the before and after so the change is readable
   * without replaying anything.
   */
  async function record(c: Context, customer: Customer, action: "CREATE" | "UPDATE", before?: Customer) {
    if (!audit) return;
    await recordSensitiveEvent(audit, {
      module: "sales",
      entityType: "CUSTOMER",
      entityId: customer.id,
      action,
      actor: getAuthContext(c)?.userId ?? "system",
      severity: before && before.creditLimit.scaled !== customer.creditLimit.scaled ? "WARNING" : "INFO",
      details: {
        code: customer.code,
        nameAr: customer.nameAr,
        creditLimit: customer.creditLimit.toString(),
        ...(before ? { previousCreditLimit: before.creditLimit.toString(), previousCode: before.code } : {}),
      },
    });
  }

  app.get("/", gate("sales.customer.view"), async (c) => {
    const customers = await repo.findAll();
    // `?q=` is Arabic-forgiving: احمد finds أحمد, فاطمه finds فاطمة. Before this
    // the parameter was not read by any list route at all, so every screen
    // filtered in the browser with a raw `includes` that forgave nothing (D32).
    const q = c.req.query("q");
    const matched = customers.filter((customer) =>
      matchesSearch(q, customer.nameAr, customer.nameEn, customer.code, customer.phone, customer.email),
    );
    return c.json(matched.map(serialize));
  });

  app.get("/:id", gate("sales.customer.view"), async (c) => {
    const customer = await repo.findById(c.req.param("id"));
    if (!customer) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(customer));
  });

  app.post("/", gate("sales.customer.create"), async (c) => {
    const parsed = createCustomerSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (await repo.findById(parsed.data.id)) {
      return c.json({ error: "ALREADY_EXISTS" }, 409);
    }
    if (await repo.findByCode(parsed.data.code)) {
      return c.json({ error: "DUPLICATE_CUSTOMER_CODE", message: `Customer code "${parsed.data.code}" already exists.` }, 409);
    }
    try {
      const { openingBalance, creditLimit, ...rest } = parsed.data;
      const customer = createCustomer({
        ...rest,
        openingBalance: openingBalance !== undefined ? Money.fromMajor(openingBalance) : undefined,
        creditLimit: creditLimit !== undefined ? Money.fromMajor(creditLimit) : undefined,
      });
      await repo.save(customer);
      await record(c, customer, "CREATE");
      return c.json(serialize(customer), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("sales.customer.edit"), async (c) => {
    const id = c.req.param("id");
    const current = await repo.findById(id);
    if (!current) return c.json({ error: "NOT_FOUND" }, 404);

    const parsed = updateCustomerSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (parsed.data.code !== undefined && parsed.data.code !== current.code) {
      const clash = await repo.findByCode(parsed.data.code);
      if (clash) {
        return c.json({ error: "DUPLICATE_CUSTOMER_CODE", message: `Customer code "${parsed.data.code}" already exists.` }, 409);
      }
    }
    try {
      // Only include openingBalance/creditLimit in the patch when the caller
      // actually supplied one — updateCustomer does a blind `{ ...current,
      // ...patch }` merge, so an explicit `undefined` value would clobber the
      // existing Money field instead of leaving it untouched.
      const { openingBalance, creditLimit, ...rest } = parsed.data;
      const patch: Parameters<typeof updateCustomer>[1] = {
        ...rest,
        ...(openingBalance !== undefined ? { openingBalance: Money.fromMajor(openingBalance) } : {}),
        ...(creditLimit !== undefined ? { creditLimit: Money.fromMajor(creditLimit) } : {}),
      };
      const next = updateCustomer(current, patch);
      await repo.save(next);
      await record(c, next, "UPDATE", current);
      return c.json(serialize(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
