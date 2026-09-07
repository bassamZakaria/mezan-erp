import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  AccountNotFoundError,
  createCustomer,
  updateCustomer,
  HeaderAccountNotPostableError,
  InactiveAccountError,
  InvalidCustomerError,
  matchesSearch,
  Money,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  recordSensitiveEvent,
  VatPeriodAlreadyFiledError,
  type AuditSink,
  type Customer,
  type CustomerRepository,
} from "@mezan/domain";
import { createCustomerSchema, updateCustomerSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

/** Resolves a price list by id, so `priceListId` can be checked against the real resource. */
export interface CustomerPriceListLookup {
  findById(id: string): Promise<unknown | null>;
}

/**
 * What each customer still owes on their LIVE sales invoices — the receivable
 * net of collections and of confirmed returns, drafts and cancelled invoices
 * excluded. It is the same figure `/sales-invoices` reports as an invoice's
 * `remainingBalance`, rolled up per customer, and the composition root MUST
 * bind it to that same derivation: a second opinion here would put the
 * customers list and the AR sub-ledger at odds.
 *
 * Optional because this module owns customer master data only and has no
 * access to invoices. Without it `GET /stats` reports `toCollect: null` and
 * `?overLimit=true` is refused, rather than either quietly reporting the
 * opening balance as the debt (D39) or passing an over-limit filter it cannot
 * evaluate.
 */
export interface CustomerReceivablesSource {
  outstandingByCustomer(): Promise<ReadonlyMap<string, Money>>;
}

/**
 * Posts a customer's opening balance to the AR control account — debit
 * receivables, credit opening-balance equity — through the same period-gated,
 * numbered, audited posting path every other document uses.
 *
 * Every migration starts by typing in the shop's existing debtors. Without
 * this the figure lived on the customer record and in the outstanding rollup
 * only, so the AR sub-ledger exceeded GL 1105 by the sum of the opening
 * balances from day one and nothing ever closed the gap (D142).
 *
 * `amount` is signed and is a DELTA: on create it is the whole opening
 * balance, on edit it is the difference from what was already posted, so the
 * sub-ledger and the control account stay equal after a correction. A negative
 * figure (a customer in credit) reverses the two sides.
 */
export type CustomerOpeningBalancePoster = (posting: {
  readonly entryId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly date: string;
  readonly amount: Money;
}) => Promise<void>;

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
    commercialRegistrationNumber: customer.commercialRegistrationNumber,
    address: customer.address,
    logoAttachmentId: customer.logoAttachmentId,
    nationalId: customer.nationalId,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof InvalidCustomerError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof VatPeriodAlreadyFiledError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Customer routes (docs/archive/catalog/01 "العملاء"): list, get one, create, edit.
 * Every route is permission-gated via the permissions engine
 * (`sales.customer.view` / `sales.customer.create` / `sales.customer.edit`).
 * Statement/balance rollups are Phase-2 (document) work — not exposed here.
 */
export function createCustomersRouter(
  repo: CustomerRepository,
  resolveAuthContext: AuthContextResolver,
  audit?: AuditSink,
  priceLists?: CustomerPriceListLookup,
  receivables?: CustomerReceivablesSource,
  openingBalanceGl?: CustomerOpeningBalancePoster,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  /**
   * `priceListId` names an entity, so it has to resolve to one. Accepting an
   * unresolvable id would price every one of this customer's invoices off the
   * item master while the screen showed a list assigned.
   */
  async function priceListMissing(priceListId: string | null | undefined): Promise<boolean> {
    if (!priceListId || !priceLists) return false;
    return (await priceLists.findById(priceListId)) === null;
  }

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

  interface CustomerListFilter {
    readonly status?: string;
    readonly q?: string;
    readonly priceListId?: string;
    readonly overLimit?: boolean;
  }

  function parseCustomerListQuery(c: Context): CustomerListFilter {
    return {
      status: c.req.query("status") || undefined,
      q: c.req.query("q") || undefined,
      priceListId: c.req.query("priceListId") || undefined,
      overLimit: c.req.query("overLimit") === "true",
    };
  }

  async function outstandingByCustomer(): Promise<ReadonlyMap<string, Money>> {
    return (await receivables?.outstandingByCustomer()) ?? new Map<string, Money>();
  }

  /** Opening balance plus what is left on every live invoice — one definition, used by both the filter and the KPI. */
  function owedBy(customer: Customer, outstanding: ReadonlyMap<string, Money>): Money {
    return customer.openingBalance.add(outstanding.get(customer.id) ?? Money.zero());
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through. The screen used to narrow by status, price list, credit limit and
   * free text in the browser while its four tiles were totalled over every
   * customer the server had sent, so applying a filter moved the rows and left
   * the header alone.
   *
   * `?q=` is Arabic-forgiving: احمد finds أحمد, فاطمه finds فاطمة. Before this
   * the parameter was not read by any list route at all, so every screen
   * filtered in the browser with a raw `includes` that forgave nothing (D32).
   */
  async function listFilteredCustomers(filter: CustomerListFilter): Promise<readonly Customer[]> {
    let rows: readonly Customer[] = await repo.findAll();
    if (filter.status === "active") rows = rows.filter((customer) => customer.active);
    else if (filter.status === "inactive") rows = rows.filter((customer) => !customer.active);
    if (filter.priceListId) rows = rows.filter((customer) => customer.priceListId === filter.priceListId);
    if (filter.overLimit) {
      const outstanding = await outstandingByCustomer();
      rows = rows.filter(
        (customer) =>
          customer.creditLimit.scaled > 0n && owedBy(customer, outstanding).scaled > customer.creditLimit.scaled,
      );
    }
    if (filter.q) {
      rows = rows.filter((customer) =>
        matchesSearch(filter.q, customer.nameAr, customer.nameEn, customer.code, customer.phone, customer.email),
      );
    }
    return rows;
  }

  /** An over-limit filter with no receivables source would silently pass every customer through. */
  function receivablesMissing(c: Context, filter: CustomerListFilter): Response | null {
    if (!filter.overLimit || receivables) return null;
    return c.json(
      { error: "RECEIVABLES_NOT_CONFIGURED", message: "تصفية العملاء المتجاوزين لحد الائتمان غير مُفعّلة على هذا الخادم." },
      501,
    );
  }

  /**
   * Posts the movement in a customer's opening balance to the AR control
   * account. Called on create (against a zero prior) and on edit (against what
   * was already posted), so a corrected opening balance moves 1105 by the
   * difference instead of leaving the sub-ledger ahead of its control (D142).
   */
  async function postOpeningBalance(customer: Customer, alreadyPosted: Money, date: string): Promise<void> {
    if (!openingBalanceGl) return;
    const delta = customer.openingBalance.add(alreadyPosted.negate());
    if (delta.scaled === 0n) return;
    await openingBalanceGl({
      entryId: `CUST-OPEN-JE:${customer.id}:${randomUUID()}`,
      customerId: customer.id,
      customerName: customer.nameAr,
      date,
      amount: delta,
    });
  }

  app.get("/", gate("sales.customer.view"), async (c) => {
    const filter = parseCustomerListQuery(c);
    const unavailable = receivablesMissing(c, filter);
    if (unavailable) return unavailable;
    return c.json((await listFilteredCustomers(filter)).map(serialize));
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   * Every other filter still applies.
   */
  app.get("/counts", gate("sales.customer.view"), async (c) => {
    const filter = parseCustomerListQuery(c);
    const unavailable = receivablesMissing(c, filter);
    if (unavailable) return unavailable;
    const { status: _ignored, ...withoutStatus } = filter;
    const customers = await listFilteredCustomers(withoutStatus);
    let active = 0;
    for (const customer of customers) if (customer.active) active += 1;
    return c.json({ all: customers.length, active, inactive: customers.length - active });
  });

  /**
   * The KPI strip. Money is summed here, in `Money`, over the whole filtered
   * set — the screen used to add JS numbers across the rows it happened to
   * hold, which both drifted and ignored the filters the user had applied.
   */
  app.get("/stats", gate("sales.customer.view"), async (c) => {
    const filter = parseCustomerListQuery(c);
    const unavailable = receivablesMissing(c, filter);
    if (unavailable) return unavailable;
    const customers = await listFilteredCustomers(filter);
    const outstanding = await outstandingByCustomer();
    let active = 0;
    let creditLimits = Money.zero();
    let toCollect = Money.zero();
    for (const customer of customers) {
      if (customer.active) active += 1;
      creditLimits = creditLimits.add(customer.creditLimit);
      toCollect = toCollect.add(owedBy(customer, outstanding));
    }
    return c.json({
      count: customers.length,
      active,
      creditLimits: creditLimits.toString(),
      toCollect: receivables ? toCollect.toString() : null,
    });
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
    if (await priceListMissing(parsed.data.priceListId)) {
      return c.json({ error: "PRICE_LIST_NOT_FOUND", message: "قائمة الأسعار المحددة غير موجودة." }, 422);
    }
    try {
      const { openingBalance, openingBalanceDate, creditLimit, ...rest } = parsed.data;
      const customer = createCustomer({
        ...rest,
        openingBalance: openingBalance !== undefined ? Money.fromMajor(openingBalance) : undefined,
        creditLimit: creditLimit !== undefined ? Money.fromMajor(creditLimit) : undefined,
      });
      // The GL post goes FIRST: a refused period must leave behind no customer
      // carrying an opening balance the control account never heard about.
      await postOpeningBalance(customer, Money.zero(), openingBalanceDate ?? today());
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
    if (await priceListMissing(parsed.data.priceListId)) {
      return c.json({ error: "PRICE_LIST_NOT_FOUND", message: "قائمة الأسعار المحددة غير موجودة." }, 422);
    }
    try {
      // Only include openingBalance/creditLimit in the patch when the caller
      // actually supplied one — updateCustomer does a blind `{ ...current,
      // ...patch }` merge, so an explicit `undefined` value would clobber the
      // existing Money field instead of leaving it untouched.
      const { openingBalance, openingBalanceDate, creditLimit, ...rest } = parsed.data;
      const patch: Parameters<typeof updateCustomer>[1] = {
        ...rest,
        ...(openingBalance !== undefined ? { openingBalance: Money.fromMajor(openingBalance) } : {}),
        ...(creditLimit !== undefined ? { creditLimit: Money.fromMajor(creditLimit) } : {}),
      };
      const next = updateCustomer(current, patch);
      await postOpeningBalance(next, current.openingBalance, openingBalanceDate ?? today());
      await repo.save(next);
      await record(c, next, "UPDATE", current);
      return c.json(serialize(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
