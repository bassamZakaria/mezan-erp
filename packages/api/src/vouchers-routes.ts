import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  VoucherService,
  voucherLine,
  invoiceOutstanding,
  getVoucherTypeDefinition,
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
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

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
    err instanceof VoucherNotAllocatableError ||
    err instanceof VoucherNotConfirmedError ||
    err instanceof AllocationAlreadyReversedError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  throw err;
}

/**
 * Treasury voucher routes (docs/catalog/04 §"السندات النقدية"), mounted under
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
function gateActorRoles(c: Context): string[] {
  const permissions = (c.req.header("x-permissions") ?? "").split(",").map((s) => s.trim());
  if (permissions.includes("*")) return ["*"];
  return (c.req.header("x-role-codes") ?? c.req.header("x-role-code") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createVouchersRoutes(
  deps: VoucherRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
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

  app.get("/", gate("treasury.cash_voucher.view"), async (c) => {
    const parsed = voucherListQuerySchema.safeParse({
      type: c.req.query("type"),
      status: c.req.query("status"),
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = serviceFor(c);
    let docs = await svc.list(parsed.data.status ? { status: parsed.data.status } : undefined);
    if (parsed.data.type) {
      docs = docs.filter((d) => voucherLine(d).voucherType === parsed.data.type);
    }
    // Row-level allocation summary so the list's "needs allocation" chip/filter
    // doesn't need an N+1 detail fetch per row (mirrors GET /:id below).
    const rows = await Promise.all(
      docs.map(async (doc) => ({
        ...serialize(doc),
        allocatable: getVoucherTypeDefinition(voucherLine(doc).voucherType).allocatable,
        allocationSummary: serializeSummary(await svc.allocationSummary(doc)),
      })),
    );
    return c.json(rows);
  });

  app.get("/:id", gate("treasury.cash_voucher.view"), async (c) => {
    const svc = serviceFor(c);
    const doc = await svc.findById(c.req.param("id"));
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
    const doc = await svc.findById(c.req.param("id"));
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
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
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
