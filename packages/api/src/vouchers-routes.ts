import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  ApprovalRequestRejectedError,
  Money,
  VoucherService,
  voucherLine,
  voucherNetPaid,
  voucherBaseAmount,
  getVoucherTypeDefinition,
  VOUCHER_TYPE_DEFINITIONS,
  InvalidDocumentError,
  InvalidDocumentTransitionError,
  DocumentNotFoundError,
  DuplicateDocumentError,
  UnbalancedEntryError,
  AccountNotFoundError,
  HeaderAccountNotPostableError,
  InactiveAccountError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  CashBalanceWouldGoNegativeError,
  VoucherNotAllocatableError,
  VoucherNotConfirmedError,
  InvoiceNotFoundError,
  AllocationNotFoundError,
  AllocationMismatchError,
  AllocationExceedsError,
  SettlementRateMissingError,
  ReversalDateBeforeOriginalError,
  allocationFxDifference,
  allocationInvoiceAmount,
  invoiceOpenBalance,
  returnedByInvoice,
  AllocationAlreadyReversedError,
  DuplicateChequeNumberError,
  auditBranchFromScope,
  branchScopedAuditSink,
  can,
  type VoucherServiceDeps,
  type VoucherDocument,
  type VoucherAllocation,
  type AllocatableInvoice,
  type AllocationSummary,
} from "@mezan/domain";
import {
  createVoucherSchema,
  confirmVoucherSchema,
  reverseVoucherSchema,
  createAllocationSchema,
  voucherListQuerySchema,
  type VoucherListQueryDTO,
} from "@mezan/contracts";
import { type AuthContextResolver, branchScopeOf, callerRoleCodes, createAnyPermissionGate, createPermissionGate, getAuthContext, withinScope } from "./permission-gate.js";
import { tenantDay } from "./tenant-day.js";

/** The register port moved into the domain with the call that uses it (D196). */
export type { VoucherChequeRegistration, VoucherChequeRegistrationPort } from "@mezan/domain";

/**
 * Everything the voucher routes bind the {@link VoucherService} to. Numbering
 * (CV- + the JE number) is the ledger store's connection-bound engine so both
 * stay gap-free; the document/allocation/invoice repos come from the voucher
 * store.
 */
export type VoucherRoutesDeps = Omit<VoucherServiceDeps, "events"> & {
  readonly events?: VoucherServiceDeps["events"];
  /** Generates ids when the request omits them. Defaults to a UUID. */
  readonly idGen?: () => string;
  /**
   * Whether Law 6/2025's simplified regime binds a payment dated `day`. A
   * taxpayer inside it is exempt from withholding tax, so the route refuses a
   * voucher that withholds rather than posting a liability to the authority
   * that the authority does not recognise (DEC-13). Omit it and nothing is
   * refused, which is the behaviour for every tenant outside the regime.
   */
  readonly simplifiedRegimeActiveOn?: (day: string) => Promise<boolean>;
};

function serialize(doc: VoucherDocument) {
  const line = voucherLine(doc);
  return {
    id: doc.id,
    docNo: doc.docNo,
    voucherType: line.voucherType,
    direction: line.direction,
    status: doc.status,
    date: doc.date,
    memo: doc.memo,
    amount: line.amount.toString(),
    currency: line.currency,
    fxRate: line.fxRate ?? null,
    baseAmount: voucherBaseAmount(line).toString(),
    branchId: line.branchId,
    paymentMethod: line.paymentMethod,
    treasuryAccountId: line.treasuryAccountId,
    treasuryGlAccountId: line.treasuryGlAccountId,
    counterpartyGlAccountId: line.counterpartyGlAccountId,
    counterTreasuryAccountId: line.counterTreasuryAccountId,
    counterTreasuryGlAccountId: line.counterTreasuryGlAccountId,
    customerId: line.customerId,
    supplierId: line.supplierId,
    referenceNo: line.referenceNo,
    costCenterId: line.costCenterId ?? null,
    projectId: line.projectId ?? null,
    costCategory: line.costCategory ?? null,
    withholdingAmount: line.withholdingAmount ? line.withholdingAmount.toString() : null,
    withholdingRatePercent: line.withholdingRatePercent ?? null,
    netPaidAmount: voucherNetPaid(line).toString(),
    journalEntryId: doc.journalEntryId,
    confirmedAt: doc.confirmedAt,
    reversesDocId: doc.reversesDocId ?? null,
  };
}

function serializeAllocation(a: VoucherAllocation) {
  return {
    id: a.id,
    voucherId: a.voucherId,
    invoiceId: a.invoiceId,
    amount: a.amount.toString(),
    invoiceAmount: allocationInvoiceAmount(a).toString(),
    fxDifference: allocationFxDifference(a).toString(),
    fxEntryId: a.fxEntryId ?? null,
    status: a.status,
    createdAt: a.createdAt,
    reversedAt: a.reversedAt,
  };
}

function serializeSummary(s: AllocationSummary) {
  return {
    voucherAmount: s.voucherAmount.toString(),
    allocated: s.allocated.toString(),
    unallocated: s.unallocated.toString(),
    fullyAllocated: s.fullyAllocated,
    needsAllocation: s.needsAllocation,
  };
}

function serializeInvoice(i: AllocatableInvoice, returned: Money = Money.zero()) {
  return {
    id: i.id,
    invoiceNo: i.invoiceNo,
    kind: i.kind,
    partyId: i.partyId,
    date: i.date,
    total: i.total.toString(),
    allocated: i.allocated.toString(),
    returned: returned.toString(),
    outstanding: invoiceOpenBalance(i, returned).toString(),
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof CashBalanceWouldGoNegativeError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof ReversalDateBeforeOriginalError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  if (
    err instanceof InvalidDocumentError ||
    err instanceof UnbalancedEntryError ||
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof AllocationMismatchError ||
    err instanceof AllocationExceedsError ||
    err instanceof SettlementRateMissingError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof DocumentNotFoundError || err instanceof InvoiceNotFoundError || err instanceof AllocationNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (
    err instanceof DuplicateDocumentError ||
    err instanceof InvalidDocumentTransitionError ||
    err instanceof ApprovalRequestRejectedError ||
    err instanceof VoucherNotAllocatableError ||
    err instanceof VoucherNotConfirmedError ||
    err instanceof AllocationAlreadyReversedError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof DuplicateChequeNumberError) {
    return c.json({ error: err.code, message: `رقم الشيك «${err.chequeNumber}» مسجّل بالفعل في سجل الشيكات.` }, 409);
  }
  throw err;
}

/**
 * Treasury voucher routes (docs/archive/catalog/04 §"السندات النقدية"), mounted under
 * `/vouchers`:
 *   GET  /vouchers                          list (type/status filters)     view
 *   GET  /vouchers/:id                      one voucher + allocation summary view
 *   POST /vouchers                          create a draft                 create
 *   POST /vouchers/:id/confirm              confirm (cash guard + GL post) confirm
 *   POST /vouchers/:id/cancel               cancel a draft/pending         void
 *   POST /vouchers/:id/reverse              reverse a confirmed voucher    void
 *   GET  /vouchers/:id/allocations          list allocations               alloc.view
 *   POST /vouchers/:id/allocations          allocate onto an invoice       alloc.manage
 *   POST /allocations/:id/reverse           reverse one allocation         alloc.manage
 *   GET  /open-invoices                     open invoices for the alloc UI alloc.view
 */
/**
 * A gate step names a ROLE code, never a permission code. The company-admin
 * wildcard still short-circuits, but a role-gated step is otherwise satisfied
 * only by a caller who actually holds that role.
 */
const gateActorRoles = callerRoleCodes;

/**
 * The voucher types that carry a permission of their own, and its prefix.
 *
 * There is ONE voucher document and one voucher list, so there is one `.view`
 * — `treasury.cash_voucher.view`. What a shop separates is not the reading but
 * the ACT: handing cash back to a customer, and moving money between the
 * company's own treasuries, are decisions kept away from the counter. Every
 * voucher route used to gate every type on `treasury.cash_voucher.*`, so the
 * two codes below gated nothing at all and a cashier who could raise a
 * collection could also raise a refund.
 *
 * The gate is "EITHER the generic code OR this type's own": a holder of only
 * `treasury.customer_refund.create` can raise a refund and nothing else, and a
 * cashier holding `treasury.cash_voucher.create` keeps every type they had.
 */
const VOUCHER_TYPE_PERMISSION_PREFIX: Readonly<Record<string, string>> = {
  customer_refund: "treasury.customer_refund",
  inter_treasury_transfer: "treasury.transfer",
};

/**
 * المقاولات — collecting a progress certificate.
 *
 * A certificate is collected by receiving the customer's money against the
 * invoice the certificate generated, and that voucher is the one that carries
 * the contract's `projectId`. `contracting.certificate.collect` named that act
 * and gated nothing, so it rode on `treasury.cash_voucher.create` — which
 * FINANCE_CONTRACTING, the role whose whole job this is, does not hold, while
 * every till cashier does.
 */
const CERTIFICATE_COLLECT = "contracting.certificate.collect";
const CERTIFICATE_COLLECTION_TYPES: ReadonlySet<string> = new Set(["customer_collection", "customer_advance"]);

type VoucherAction = "create" | "confirm" | "void";

/** Every code that authorises `action` on a voucher of this type. Any one suffices. */
function voucherPermissions(
  action: VoucherAction,
  voucherType: string | null | undefined,
  projectId: string | null | undefined,
): string[] {
  const codes = [`treasury.cash_voucher.${action}`];
  const prefix = voucherType ? VOUCHER_TYPE_PERMISSION_PREFIX[voucherType] : undefined;
  if (prefix) codes.push(`${prefix}.${action}`);
  if (action !== "void" && projectId && voucherType && CERTIFICATE_COLLECTION_TYPES.has(voucherType)) {
    codes.push(CERTIFICATE_COLLECT);
  }
  return codes;
}

/**
 * The 403 for a caller who cleared the route's broad gate but holds none of
 * the codes THIS voucher's type needs, or null when they may proceed.
 *
 * The middleware gate has to admit every code any type might need — it runs
 * before the body is parsed and before the document is loaded — so without
 * this second, narrow check a `treasury.customer_refund.create` holder would
 * be able to raise any voucher at all, which is a wider grant than the one the
 * catalogue describes.
 */
function refuseVoucherType(c: Context, permissions: readonly string[]): Response | null {
  const ctx = getAuthContext(c);
  if (ctx && permissions.some((permission) => can(ctx, permission))) return null;
  return c.json(
    {
      error: "PERMISSION_DENIED",
      permission: permissions[permissions.length - 1],
      message: `هذا الإجراء يتطلب صلاحية «${permissions[permissions.length - 1]}» غير المتاحة لحسابك.`,
    },
    403,
  );
}

export function createVouchersRoutes(
  deps: VoucherRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  function serviceFor(c: Context): VoucherService {
    const ctx = getAuthContext(c);
    const actor = ctx?.userId ?? deps.actor ?? "system";
    // The audit sink is stamped with the branch the caller is working in, read
    // off the same `x-branch-scope` the permission gate already resolved.
    const audit = deps.audit
      ? branchScopedAuditSink(deps.audit, ctx ? auditBranchFromScope(ctx.branchScope) : null)
      : undefined;
    return new VoucherService({ ...deps, actor, audit });
  }

  function parseListQuery(c: Context) {
    return voucherListQuerySchema.safeParse({
      type: c.req.query("type"),
      status: c.req.query("status"),
      branchId: c.req.query("branchId"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
      search: c.req.query("search"),
      needsAllocation: c.req.query("needsAllocation"),
      page: c.req.query("page"),
      pageSize: c.req.query("pageSize"),
    });
  }

  /**
   * One filter for the rows and the chip counts alike (R1.1, R8.2, R8.3). The
   * needs-allocation queue is computed HERE, not in the browser: it is a work
   * queue that has to be right over every voucher, not over the page the
   * client happens to hold.
   */
  async function listFilteredVouchers(
    c: Context,
    filter: VoucherListQueryDTO,
    page?: { limit: number; offset: number },
  ) {
    const svc = serviceFor(c);
    // The date bounds are columns, so they narrow at the store; the JS pass
    // below re-applies them for a repository that cannot express them.
    let docs = await svc.list({
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.fromDate ? { fromDate: filter.fromDate } : {}),
      ...(filter.toDate ? { toDate: filter.toDate } : {}),
    });
    if (filter.type) docs = docs.filter((d) => voucherLine(d).voucherType === filter.type);
    if (filter.branchId) docs = docs.filter((d) => voucherLine(d).branchId === filter.branchId);
    if (filter.fromDate) docs = docs.filter((d) => d.date >= filter.fromDate!);
    if (filter.toDate) docs = docs.filter((d) => d.date <= filter.toDate!);
    const term = filter.search?.trim().toLowerCase();
    if (term) {
      docs = docs.filter(
        (d) =>
          (d.docNo ?? "").toLowerCase().includes(term) ||
          (voucherLine(d).referenceNo ?? "").toLowerCase().includes(term),
      );
    }
    docs = [...withinScope(docs, branchScopeOf(c), (d) => voucherLine(d).branchId)];

    // Cut the page BEFORE the per-row allocation summary — that summary is a
    // sub-ledger read per voucher, and running it over the whole book to
    // return twenty-five rows is the N+1 this exists to avoid (Q-8). It cannot
    // be cut here when the needs-allocation queue is the filter, because that
    // filter reads the summary; that case pages after it instead.
    const pagesAfterAllocation = filter.needsAllocation !== undefined;
    const window = page && !pagesAfterAllocation ? docs.slice(page.offset, page.offset + page.limit) : docs;

    // Row-level allocation summary so the list's "needs allocation" chip and
    // filter don't need an N+1 detail fetch per row.
    let rows = await Promise.all(
      window.map(async (doc) => {
        const line = voucherLine(doc);
        const def = getVoucherTypeDefinition(line.voucherType);
        return {
          ...serialize(doc),
          allocatable: def.allocatable,
          allocationSummary: serializeSummary(await svc.allocationSummary(doc)),
          direction: def.direction,
        };
      }),
    );

    if (filter.needsAllocation) {
      rows = rows.filter(
        (row) =>
          row.status === "confirmed" &&
          row.allocatable &&
          row.allocationSummary.needsAllocation &&
          (filter.needsAllocation === "any" || row.direction === filter.needsAllocation),
      );
      if (page) rows = rows.slice(page.offset, page.offset + page.limit);
    }
    return rows;
  }

  app.get("/", gate("treasury.cash_voucher.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const { page, pageSize } = parsed.data;
    return c.json(await listFilteredVouchers(c, parsed.data, { limit: pageSize, offset: (page - 1) * pageSize }));
  });

  /**
   * The chip counts (R1.1/R8.2). The list has TWO chip axes — status (with the
   * needs-allocation queues) and type — and each one drops only its own
   * filter: a chip states how many rows IT would show, so it must honour every
   * OTHER filter the user has applied. Dropping both axes at once made the
   * status chips read the whole book while a type was selected (14 vouchers on
   * the "All" chip over a 3-row list); dropping neither made every unselected
   * chip read zero.
   */
  app.get("/counts", gate("treasury.cash_voucher.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const { status: _s, needsAllocation: _n, ...withoutStatusAxis } = parsed.data;
    const { type: _t, ...withoutTypeAxis } = parsed.data;
    const statusAxisRows = await listFilteredVouchers(c, withoutStatusAxis);
    const typeAxisRows = await listFilteredVouchers(c, withoutTypeAxis);
    const counts: Record<string, number> = {
      all: statusAxisRows.length,
      draft: 0,
      confirmed: 0,
      pending: 0,
      cancelled: 0,
      needs_allocation: 0,
      needs_allocation_receipt: 0,
      needs_allocation_payment: 0,
    };
    for (const row of statusAxisRows) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      if (row.status === "confirmed" && row.allocatable && row.allocationSummary.needsAllocation) {
        counts.needs_allocation! += 1;
        if (row.direction === "receipt") counts.needs_allocation_receipt! += 1;
        if (row.direction === "payment") counts.needs_allocation_payment! += 1;
      }
    }
    // Every type gets a count, including the ones with no vouchers — a type
    // filter that only lists types already used cannot be used to find that a
    // type has none.
    for (const def of VOUCHER_TYPE_DEFINITIONS) {
      counts[`type:${def.code}`] = typeAxisRows.filter((row) => row.voucherType === def.code).length;
    }
    return c.json(counts);
  });

  /**
   * The KPI strip (R1.1), summed in `Money` over the SAME chokepoint the rows
   * come from. Unlike `/counts` this one honours the status filter, because
   * the strip describes the rows on screen rather than the chips above them.
   *
   * A تحويل (transfer) moves money between two treasury accounts, so it is one
   * of the counted rows but belongs in neither money total — adding it to
   * either side would invent cash the business never received or paid.
   */
  app.get("/stats", gate("treasury.cash_voucher.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const rows = await listFilteredVouchers(c, parsed.data);
    let confirmed = 0;
    let draft = 0;
    let needsAllocation = 0;
    let receipts = Money.zero();
    let payments = Money.zero();
    let unallocated = Money.zero();
    for (const row of rows) {
      if (row.status === "draft") draft += 1;
      if (row.status !== "confirmed") continue;
      confirmed += 1;
      const amount = Money.fromMajor(row.amount);
      if (row.direction === "receipt") receipts = receipts.add(amount);
      if (row.direction === "payment") payments = payments.add(amount);
      if (row.allocatable && row.allocationSummary.needsAllocation) {
        needsAllocation += 1;
        unallocated = unallocated.add(Money.fromMajor(row.allocationSummary.unallocated));
      }
    }
    return c.json({
      count: rows.length,
      confirmed,
      needsAllocation,
      draft,
      receipts: receipts.toString(),
      payments: payments.toString(),
      net: Money.fromScaled(receipts.scaled - payments.scaled).toString(),
      unallocated: unallocated.toString(),
    });
  });

  /**
   * The document this caller may see, or null. A voucher outside the caller's
   * branch scope is reported as ABSENT, not forbidden: the list already hides
   * it, so answering 403 by id would confirm it exists (D130).
   */
  async function findInScope(c: Context, svc: VoucherService, id: string): Promise<VoucherDocument | null> {
    // A voucher is also addressed by its number (`/treasury/treasury-vouchers/CV-000979`).
    const doc = (await svc.findById(id)) ?? (await svc.list({})).find((d) => d.docNo === id) ?? null;
    if (!doc) return null;
    const visible = withinScope([doc], branchScopeOf(c), (d) => voucherLine(d).branchId);
    return visible.length === 1 ? doc : null;
  }

  app.get("/:id", gate("treasury.cash_voucher.view"), async (c) => {
    const svc = serviceFor(c);
    const doc = await findInScope(c, svc, c.req.param("id"));
    if (!doc) return c.json({ error: "NOT_FOUND" }, 404);
    const line = voucherLine(doc);
    const allocatable = getVoucherTypeDefinition(line.voucherType).allocatable;
    const summary = await svc.allocationSummary(doc);
    const allocations = await svc.listAllocations(doc.id);
    return c.json({
      ...serialize(doc),
      allocatable,
      allocationSummary: serializeSummary(summary),
      allocations: allocations.map(serializeAllocation),
    });
  });

  app.post(
    "/",
    gateAny(
      "treasury.cash_voucher.create",
      "treasury.customer_refund.create",
      "treasury.transfer.create",
      CERTIFICATE_COLLECT,
    ),
    async (c) => {
    const parsed = createVoucherSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const d = parsed.data;
    const refusal = refuseVoucherType(c, voucherPermissions("create", d.voucherType, d.projectId));
    if (refusal) return refusal;
    /*
     * Law 6/2025 exempts a taxpayer inside the simplified regime from
     * withholding tax. Accepting a withholding amount anyway would post a
     * liability to an authority that does not recognise it, and the figure
     * would then travel into the filing. Refused rather than silently zeroed:
     * the operator typed a number, and a number that vanishes without a word
     * is how a wrong filing gets signed (DEC-13).
     */
    if (d.withholdingAmount && Money.fromMajor(d.withholdingAmount).scaled !== 0n && deps.simplifiedRegimeActiveOn) {
      if (await deps.simplifiedRegimeActiveOn(d.date)) {
        return c.json(
          {
            error: "WITHHOLDING_NOT_ALLOWED_UNDER_SIMPLIFIED_REGIME",
            message:
              "المنشأة مسجّلة في النظام الضريبي المبسط (قانون ٦ لسنة ٢٠٢٥) وهي معفاة من الخصم والتحصيل، فلا يجوز خصم ضريبة على هذا السند.",
          },
          422,
        );
      }
    }
    try {
      const svc = serviceFor(c);
      const doc = await svc.createVoucher({
        id: d.id ?? idGen(),
        date: d.date,
        memo: d.memo,
        voucherType: d.voucherType,
        amount: Money.fromMajor(d.amount),
        currency: d.currency,
        branchId: d.branchId,
        paymentMethod: d.paymentMethod,
        treasuryAccountId: d.treasuryAccountId,
        treasuryGlAccountId: d.treasuryGlAccountId,
        counterpartyGlAccountId: d.counterpartyGlAccountId ?? null,
        counterTreasuryAccountId: d.counterTreasuryAccountId ?? null,
        counterTreasuryGlAccountId: d.counterTreasuryGlAccountId ?? null,
        customerId: d.customerId ?? null,
        supplierId: d.supplierId ?? null,
        referenceNo: d.referenceNo ?? null,
        costCenterId: d.costCenterId ?? null,
        projectId: d.projectId ?? null,
        costCategory: d.costCategory ?? null,
        withholdingAmount: d.withholdingAmount ? Money.fromMajor(d.withholdingAmount) : null,
        withholdingRatePercent: d.withholdingRatePercent ?? null,
        withholdingGlAccountId: d.withholdingGlAccountId ?? null,
      });
      return c.json(serialize(doc), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
    },
  );

  /**
   * The per-type refusal for a voucher already in the store: `confirm`,
   * `cancel` and `reverse` name the voucher by id, so the type comes off the
   * stored document rather than off a request body that does not carry one.
   *
   * A voucher that is not there at all is left to the handler, so a missing id
   * keeps answering the domain's own 404 rather than gaining a second shape.
   */
  async function refuseStoredVoucher(c: Context, id: string, action: VoucherAction): Promise<Response | null> {
    const doc = await serviceFor(c).findById(id);
    if (!doc) return null;
    const line = voucherLine(doc);
    return refuseVoucherType(c, voucherPermissions(action, line.voucherType, line.projectId ?? null));
  }

  app.post(
    "/:id/confirm",
    gateAny(
      "treasury.cash_voucher.confirm",
      "treasury.customer_refund.confirm",
      "treasury.transfer.confirm",
      CERTIFICATE_COLLECT,
    ),
    async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = confirmVoucherSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const refusal = await refuseStoredVoucher(c, c.req.param("id"), "confirm");
    if (refusal) return refusal;
    try {
      const ctx = getAuthContext(c);
      const result = await serviceFor(c).confirmVoucher(c.req.param("id"), {
        requestId: parsed.data.requestId,
        actor: ctx?.userId,
        actorRoles: gateActorRoles(c),
      });
      return c.json({ ...serialize(result.document), held: result.held });
    } catch (err) {
      return handleDomainError(c, err);
    }
    },
  );

  app.post(
    "/:id/cancel",
    gateAny("treasury.cash_voucher.void", "treasury.customer_refund.void", "treasury.transfer.void"),
    async (c) => {
      const refusal = await refuseStoredVoucher(c, c.req.param("id"), "void");
      if (refusal) return refusal;
      try {
        const doc = await serviceFor(c).cancelVoucher(c.req.param("id"));
        return c.json(serialize(doc));
      } catch (err) {
        return handleDomainError(c, err);
      }
    },
  );

  app.post(
    "/:id/reverse",
    gateAny("treasury.cash_voucher.void", "treasury.customer_refund.void", "treasury.transfer.void"),
    async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = reverseVoucherSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const refusal = await refuseStoredVoucher(c, c.req.param("id"), "void");
    if (refusal) return refusal;
    try {
      const result = await serviceFor(c).reverseVoucher(c.req.param("id"), {
        reversalId: parsed.data.reversalId ?? idGen(),
        // No date sent (D270) defaults to today, in the tenant's own
        // calendar day — the same rule a cheque bounce already follows —
        // never the voucher's own day, which would restate a day already
        // reported. `deps.now`, not a raw `new Date()`, so it stays the same
        // injectable clock every other default in this route uses.
        date: await tenantDay(c, parsed.data.date ?? (deps.now ? deps.now() : new Date().toISOString())),
        memo: parsed.data.memo,
      });
      return c.json({ original: serialize(result.original), reversal: serialize(result.reversal) }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
    },
  );

  app.get("/:id/allocations", gate("treasury.allocation.view"), async (c) => {
    const svc = serviceFor(c);
    const doc = await findInScope(c, svc, c.req.param("id"));
    if (!doc) return c.json({ error: "NOT_FOUND" }, 404);
    const allocations = await svc.listAllocations(doc.id);
    return c.json({
      allocationSummary: serializeSummary(await svc.allocationSummary(doc)),
      allocations: allocations.map(serializeAllocation),
    });
  });

  app.post("/:id/allocations", gate("treasury.allocation.manage"), async (c) => {
    const parsed = createAllocationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await serviceFor(c).allocate(c.req.param("id"), {
        allocationId: parsed.data.allocationId ?? idGen(),
        invoiceId: parsed.data.invoiceId,
        amount: Money.fromMajor(parsed.data.amount),
        date: await tenantDay(c, new Date().toISOString()),
      });
      return c.json(serializeAllocation(result.allocation), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

/**
 * The allocation-reverse and open-invoice endpoints live outside `/vouchers/:id`
 * so they mount at the app root: `/allocations/:id/reverse` and `/open-invoices`.
 */
export function createAllocationRoutes(
  deps: VoucherRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const service = () => new VoucherService(deps);

  app.post("/allocations/:id/reverse", gate("treasury.allocation.manage"), async (c) => {
    try {
      const result = await service().reverseAllocation(c.req.param("id"), { date: await tenantDay(c, new Date().toISOString()) });
      return c.json(serializeAllocation(result.allocation));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/open-invoices", gate("treasury.allocation.view"), async (c) => {
    const kindParam = c.req.query("kind");
    const kind = kindParam === "sales" || kindParam === "purchase" ? kindParam : undefined;
    const partyId = c.req.query("partyId") ?? undefined;
    const invoices = await deps.invoices.listOpen({ kind, partyId });
    // A return clears debt without an allocation; an invoice it cleared is not
    // open, and what is open on one it touched is net of it (D242).
    const returned = await returnedByInvoice(deps.returns, invoices);
    return c.json(
      invoices
        .map((invoice) => serializeInvoice(invoice, returned.get(invoice.id)))
        .filter((invoice) => Money.fromMajor(invoice.outstanding).scaled > 0n),
    );
  });

  return app;
}
