import { Hono, type Context } from "hono";
import { nextMasterCode } from "./master-code.js";
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
  AuditChangeAction,
  VatPeriodAlreadyFiledError,
  type AuditSink,
  type Customer,
  type CustomerRepository,
  POS_WALK_IN_CUSTOMER_ID,
} from "@mezan/domain";
import { createCustomerSchema, updateCustomerSchema } from "@mezan/contracts";
import {
  branchScopeOf,
  createPermissionGate,
  withinScope,
  type AuthContextResolver,
} from "./permission-gate.js";
import { recordFieldChanges } from "./admin-audit.js";
import { tenantToday } from "./tenant-day.js";

/** Resolves a price list by id, so `priceListId` can be checked against the real resource. */
export interface CustomerPriceListLookup {
  findById(id: string): Promise<unknown | null>;
}

/**
 * What each customer still owes, excluding the opening balance: their row
 * total on the customer aging ladder, and the composition root MUST bind it to
 * the ladder's own computation (D195) — a second opinion here would put the
 * customers list and the ladder at odds.
 *
 * Optional because this module owns customer master data only and has no
 * access to invoices. Without it `GET /stats` reports `toCollect: null` and
 * `?overLimit=true` is refused, rather than either quietly reporting the
 * opening balance as the debt (D39) or passing an over-limit filter it cannot
 * evaluate.
 */
export interface CustomerReceivablesSource {
  /** `today` is the TENANT's calendar day, resolved at the route (D288). */
  outstandingByCustomer(today: string): Promise<ReadonlyMap<string, Money>>;
}

/**
 * Posts a party's رصيد افتتاحي into the general ledger, idempotently, under
 * ONE deterministic entry id per party — the same poster the customers
 * screen, the suppliers screen and the start-up backfill all call, so this
 * class of bug (D241: a screen posting under one id and a backfill posting
 * the same balance again under another) cannot reopen through a second
 * posting path appearing later.
 *
 * The opening balance used to be a number stored on the master record and
 * nowhere else: never posted, counted in the customer KPI and in the browser
 * statement, and invisible to `/reconciliation` and the aging ladder — one
 * fact, three figures, none of them the ledger (B-2). The historical-import
 * path already posted the identical entry (Dr AR / Cr 3210); this port routes
 * the master-data field through the same posting.
 *
 * A correction (the balance changed since it last posted) reverses the
 * standing entry and posts the new figure — never edits it (D142/D241).
 * `date` is honoured for the customers screen's own opening-balance date
 * field; omitted, the poster dates it at the first day of the earliest open
 * fiscal period.
 *
 * Optional because this module owns master data only. Without it nothing is
 * posted and nothing is counted, which is honest; the figure simply is not a
 * receivable until the ledger says so.
 */
export interface PartyOpeningBalancePoster {
  post(party: { readonly id: string; readonly code: string; readonly nameAr: string; readonly openingBalance: Money }, date?: string): Promise<void>;
}

/** Wire representation of a customer — a plain JSON-safe projection with Money as decimal strings. */
function serialize(customer: Customer) {
  return {
    id: customer.id,
    branchId: customer.branchId,
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

export const AUDITED_CUSTOMER_FIELDS = [
  "branchId",
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
  "priceListId",
  "creditLimit",
  "taxExempt",
  "etaBuyerType",
  "commercialRegistrationNumber",
  "address",
  "nationalId",
] as const;

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
    const messageEn = (err as Error & { messageEn?: string }).messageEn;
    return c.json({ error: err.code, message: err.message, ...(messageEn ? { messageEn } : {}) }, 422);
  }
  throw err;
}

/**
 * A customer's own trail. The credit limit is the reason this matters: it is
 * the one master-data field that decides how much a salesperson may sell on
 * credit, and raising it quietly is the cheapest way to push a bad debt
 * through. `details` records the before and after so the change is readable
 * without replaying anything. Every writer of a customer goes through this one
 * function, so the history panel misses none of them.
 */
export function recordCustomerChange(
  audit: AuditSink | undefined,
  c: Context,
  customer: Customer,
  action: AuditChangeAction,
  before?: Customer,
) {
  return recordFieldChanges(audit, c, {
    entity: { module: "sales", entityType: "CUSTOMER", entityId: customer.id },
    action,
    before: before ? serialize(before) : null,
    after: serialize(customer),
    fields: AUDITED_CUSTOMER_FIELDS,
    warnOn: ["creditLimit", "openingBalance", "priceListId", "taxNumber", "taxExempt", "active"],
    details: { code: customer.code, nameAr: customer.nameAr },
  });
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
  /** Posts the customer's رصيد افتتاحي into the ledger (Dr 1105 / Cr 3210) — see suppliers-routes.ts (B-2, D241). */
  openingBalances?: PartyOpeningBalancePoster,
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

  function record(c: Context, customer: Customer, action: AuditChangeAction, before?: Customer) {
    return recordCustomerChange(audit, c, customer, action, before);
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

  async function outstandingByCustomer(c: Context): Promise<ReadonlyMap<string, Money>> {
    return (await receivables?.outstandingByCustomer(await tenantToday(c))) ?? new Map<string, Money>();
  }

  /** The customer's aging row, which carries the opening balance itself (D204) — one definition, used by both the filter and the KPI. */
  function owedBy(customer: Customer, outstanding: ReadonlyMap<string, Money>): Money {
    return outstanding.get(customer.id) ?? Money.zero();
  }

  async function withOwed(c: Context, rows: readonly Customer[]) {
    const outstanding = receivables ? await outstandingByCustomer(c) : null;
    return rows.map((customer) => ({
      ...serialize(customer),
      owed: outstanding ? owedBy(customer, outstanding).toString() : null,
    }));
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
  async function listFilteredCustomers(c: Context, filter: CustomerListFilter): Promise<readonly Customer[]> {
    /*
     * The caller's branch scope decides what they may see at all (D71): a
     * customer record carried no branch, so every rep saw the whole company's
     * customer book — the asset a departing rep walks out with. No query
     * parameter widens this.
     *
     * `withinScope` keeps a customer with NO branch visible to everyone, which
     * is deliberate: every record written before the column existed has none,
     * and hiding them would empty the screen for a branch-scoped user rather
     * than protect anything.
     */
    let rows: readonly Customer[] = withinScope(await repo.findAll(), branchScopeOf(c), (customer) => customer.branchId);
    if (filter.status === "active") rows = rows.filter((customer) => customer.active);
    else if (filter.status === "inactive") rows = rows.filter((customer) => !customer.active);
    if (filter.priceListId) rows = rows.filter((customer) => customer.priceListId === filter.priceListId);
    if (filter.overLimit) {
      const outstanding = await outstandingByCustomer(c);
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
   * Hands the customer's CURRENT opening balance to the shared poster
   * (`PartyOpeningBalancePoster`) — the same one the suppliers screen and the
   * start-up backfill call. `date` is the screen's own opening-balance date
   * field, undefined when the caller left it out: the poster then dates it at
   * the first day of the earliest open fiscal period, rather than "today",
   * which could fall in whatever month the operator happens to be in or in a
   * closed one (D223's reasoning, D241's unification).
   */
  async function postOpeningBalance(customer: Customer, date: string | undefined): Promise<void> {
    await openingBalances?.post(customer, date);
  }

  app.get("/", gate("sales.customer.view"), async (c) => {
    const filter = parseCustomerListQuery(c);
    const unavailable = receivablesMissing(c, filter);
    if (unavailable) return unavailable;
    const rows = await listFilteredCustomers(c, filter);
    return c.json(await withOwed(c, rows));
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
    const customers = await listFilteredCustomers(c, withoutStatus);
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
    const customers = await listFilteredCustomers(c, filter);
    const outstanding = await outstandingByCustomer(c);
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
    // 404 rather than 403: an id outside the caller's scope must not confirm
    // that the record exists.
    if (withinScope([customer], branchScopeOf(c), (row) => row.branchId).length === 0) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
    return c.json((await withOwed(c, [customer]))[0]);
  });

  app.post("/", gate("sales.customer.create"), async (c) => {
    const parsed = createCustomerSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (await repo.findById(parsed.data.id)) {
      return c.json({ error: "ALREADY_EXISTS" }, 409);
    }
    const code = parsed.data.code ?? nextMasterCode((await repo.findAll()).map((row) => row.code), "C");
    if (await repo.findByCode(code)) {
      return c.json({ error: "DUPLICATE_CUSTOMER_CODE", message: `كود العميل «${code}» مستخدم بالفعل.` }, 409);
    }
    if (await priceListMissing(parsed.data.priceListId)) {
      return c.json({ error: "PRICE_LIST_NOT_FOUND", message: "قائمة الأسعار المحددة غير موجودة." }, 422);
    }
    try {
      const { openingBalance, openingBalanceDate, creditLimit, ...fields } = parsed.data;
      const rest = { ...fields, code };
      // A caller scoped to exactly one branch stamps it; a tenant-wide caller
      // leaves the record shared, which is what the all-branch sentinel means.
      const scope = branchScopeOf(c);
      const customer = createCustomer({
        ...rest,
        branchId: rest.branchId ?? (scope?.length === 1 ? scope[0] : null),
        openingBalance: openingBalance !== undefined ? Money.fromMajor(openingBalance) : undefined,
        creditLimit: creditLimit !== undefined ? Money.fromMajor(creditLimit) : undefined,
      });
      // The GL post goes FIRST: a refused period must leave behind no customer
      // carrying an opening balance the control account never heard about.
      await postOpeningBalance(customer, openingBalanceDate);
      await repo.save(customer);
      await record(c, customer, AuditChangeAction.Create);
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
    // Every POS sale with no named buyer is invoiced to this customer: it must
    // stay active and stay a consumer (no tax number), or the till stops selling.
    if (
      id === POS_WALK_IN_CUSTOMER_ID &&
      (parsed.data.active === false || (parsed.data.taxNumber ?? "").trim() !== "")
    ) {
      return c.json(
        {
          error: "WALK_IN_CUSTOMER_LOCKED",
          message: "«زبون عابر» تبيع له نقاط البيع — لا يُعطَّل ولا يُسجَّل له رقم ضريبي.",
        },
        409,
      );
    }
    if (parsed.data.code !== undefined && parsed.data.code !== current.code) {
      const clash = await repo.findByCode(parsed.data.code);
      if (clash) {
        return c.json({ error: "DUPLICATE_CUSTOMER_CODE", message: `كود العميل «${parsed.data.code}» مستخدم بالفعل.` }, 409);
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
      // The poster recomputes the delta itself from the ledger (D241) — only
      // call it when the balance actually moved, so an unrelated edit
      // (credit limit, phone number…) touches nothing.
      if (next.openingBalance.scaled !== current.openingBalance.scaled) {
        await postOpeningBalance(next, openingBalanceDate);
      }
      await repo.save(next);
      await record(c, next, AuditChangeAction.Update, current);
      return c.json(serialize(next));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
