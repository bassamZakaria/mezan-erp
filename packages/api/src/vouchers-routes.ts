import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  ApprovalRequestRejectedError,
  Money,
  VoucherService,
  voucherLine,
  voucherNetPaid,
  invoiceOutstanding,
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
  AllocationAlreadyReversedError,
  auditBranchFromScope,
  branchScopedAuditSink,
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
import { type AuthContextResolver, branchScopeOf, callerRoleCodes, createPermissionGate, getAuthContext, withinScope } from "./permission-gate.js";

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
    withholdingAmount: line.withholdingAmount ? line.withholdingAmount.toString() : null,
    withholdingRatePercent: line.withholdingRatePercent ?? null,
    netPaidAmount: voucherNetPaid(line).toString(),
    journalEntryId: doc.journalEntryId,
    confirmedAt: doc.confirmedAt,
  };
}

function serializeAllocation(a: VoucherAllocation) {
  return {
    id: a.id,
    voucherId: a.voucherId,
    invoiceId: a.invoiceId,
    amount: a.amount.toString(),
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

function serializeInvoice(i: AllocatableInvoice) {
  return {
    id: i.id,
    invoiceNo: i.invoiceNo,
    kind: i.kind,
    partyId: i.partyId,
    date: i.date,
    total: i.total.toString(),
    allocated: i.allocated.toString(),
    outstanding: invoiceOutstanding(i).toString(),
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof CashBalanceWouldGoNegativeError) {
    return c.json({ error: err.code, message: err.message }, 422);
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
    err instanceof AllocationExceedsError
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

export function createVouchersRoutes(
  deps: VoucherRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
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
    });
  }

  /**
   * One filter for the rows and the chip counts alike (R1.1, R8.2, R8.3). The
   * needs-allocation queue is computed HERE, not in the browser: it is a work
   * queue that has to be right over every voucher, not over the page the
   * client happens to hold.
   */
  async function listFilteredVouchers(c: Context, filter: VoucherListQueryDTO) {
    const svc = serviceFor(c);
    let docs = await svc.list(filter.status ? { status: filter.status } : undefined);
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

    // Row-level allocation summary so the list's "needs allocation" chip and
    // filter don't need an N+1 detail fetch per row.
    let rows = await Promise.all(
      docs.map(async (doc) => {
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
    }
    return rows;
  }

  app.get("/", gate("treasury.cash_voucher.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    return c.json(await listFilteredVouchers(c, parsed.data));
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
    const doc = await svc.findById(id);
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

  app.post("/", gate("treasury.cash_voucher.create"), async (c) => {
    const parsed = createVoucherSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const d = parsed.data;
    try {
      const doc = await serviceFor(c).createVoucher({
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
        withholdingAmount: d.withholdingAmount ? Money.fromMajor(d.withholdingAmount) : null,
        withholdingRatePercent: d.withholdingRatePercent ?? null,
        withholdingGlAccountId: d.withholdingGlAccountId ?? null,
      });
      return c.json(serialize(doc), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/confirm", gate("treasury.cash_voucher.confirm"), async (c) => {
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
  });

  app.post("/:id/cancel", gate("treasury.cash_voucher.void"), async (c) => {
    try {
      const doc = await serviceFor(c).cancelVoucher(c.req.param("id"));
      return c.json(serialize(doc));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/reverse", gate("treasury.cash_voucher.void"), async (c) => {
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
    try {
      const result = await serviceFor(c).reverseVoucher(c.req.param("id"), {
        reversalId: parsed.data.reversalId ?? idGen(),
        date: parsed.data.date,
        memo: parsed.data.memo,
      });
      return c.json({ original: serialize(result.original), reversal: serialize(result.reversal) }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

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
      const result = await service().reverseAllocation(c.req.param("id"));
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
    return c.json(invoices.map(serializeInvoice));
  });

  return app;
}
