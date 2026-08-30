import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  ChequeService,
  Money,
  CHEQUE_STATUS_DEFINITIONS,
  effectiveChequeStatus,
  ChequeNotFoundError,
  DuplicateChequeNumberError,
  InvalidChequeCommandError,
  InvalidChequeTransitionError,
  MissingBouncedAccountError,
  ReplacementAmountMismatchError,
  UnbalancedEntryError,
  AccountNotFoundError,
  HeaderAccountNotPostableError,
  InactiveAccountError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  type Cheque,
  type ChequeServiceDeps,
} from "@mezan/domain";
import {
  createChequeSchema,
  depositChequeSchema,
  collectChequeSchema,
  bounceChequeSchema,
  replaceChequeSchema,
  chequeListQuerySchema,
  type ChequeListQueryDTO,
} from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";

export type ChequeRoutesDeps = ChequeServiceDeps & {
  /** Generates ids (cheque id, journal-entry id) when the request omits them. Defaults to a UUID. */
  readonly idGen?: () => string;
};

function serialize(cheque: Cheque, asOfDate: string) {
  return {
    id: cheque.id,
    direction: cheque.direction,
    status: cheque.status,
    effectiveStatus: effectiveChequeStatus(cheque, asOfDate),
    chequeNumber: cheque.chequeNumber,
    bankName: cheque.bankName,
    bankBranchName: cheque.bankBranchName,
    bankAccountNumber: cheque.bankAccountNumber,
    amount: cheque.amount.toString(),
    currency: cheque.currency,
    issueDate: cheque.issueDate,
    dueDate: cheque.dueDate,
    branchId: cheque.branchId,
    notes: cheque.notes,
    partyId: cheque.partyId,
    counterpartyGlAccountId: cheque.counterpartyGlAccountId,
    controlAccounts: cheque.controlAccounts,
    bankTreasuryAccountId: cheque.bankTreasuryAccountId,
    createdAt: cheque.createdAt,
    depositedAt: cheque.depositedAt,
    collectedAt: cheque.collectedAt,
    bouncedAt: cheque.bouncedAt,
    replacesChequeId: cheque.replacesChequeId,
    replacedByChequeId: cheque.replacedByChequeId,
    creationJournalEntryId: cheque.creationJournalEntryId,
    collectionJournalEntryId: cheque.collectionJournalEntryId,
    bounceJournalEntryId: cheque.bounceJournalEntryId,
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof ChequeNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateChequeNumberError || err instanceof InvalidChequeTransitionError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof InvalidChequeCommandError ||
    err instanceof MissingBouncedAccountError ||
    err instanceof ReplacementAmountMismatchError ||
    err instanceof UnbalancedEntryError ||
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * Cheque register routes (docs/archive/catalog/04 §"سجل الشيكات"), mounted under `/cheques`:
 *   GET  /cheques                  list (direction/status/date/search)   cheques.view
 *   GET  /cheques/counts            status-chip counts                  cheques.view
 *   GET  /cheques/stats             KPI strip (count + money)           cheques.view
 *   GET  /cheques/:id               one cheque                          cheques.view
 *   POST /cheques                   record a new cheque                 cheques.create
 *   POST /cheques/:id/deposit       hand to the bank for collection      cheques.deposit
 *   POST /cheques/:id/collect       bank confirms clearance              cheques.collect
 *   POST /cheques/:id/bounce        bank rejects it                      cheques.bounce
 *   POST /cheques/:id/replace       replace a bounced cheque             cheques.create
 *
 * Only 5 `cheques.*` permissions exist (view/create/deposit/collect/bounce —
 * see permissions/catalog.ts module 13); "replace" is gated on `.create`
 * since it fundamentally records a new cheque instrument (see
 * `ChequeService.replace`'s doc comment). "تحت التحصيل"/"المستحقة اليوم" have
 * no endpoints of their own — they're derived at read time (status.ts).
 */
export function createChequesRoutes(deps: ChequeRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());
  const service = new ChequeService(deps);
  const asOf = () => (deps.now ? deps.now() : new Date().toISOString()).slice(0, 10);

  type ChequeListFilter = ChequeListQueryDTO & { readonly search?: string };

  function parseListQuery(c: Context): { ok: true; filter: ChequeListFilter } | { ok: false; details: unknown } {
    const parsed = chequeListQuerySchema.safeParse({
      direction: c.req.query("direction"),
      status: c.req.query("status"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) return { ok: false, details: parsed.error.flatten() };
    return { ok: true, filter: { ...parsed.data, search: c.req.query("search") || undefined } };
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through (R1.1) — none of the three may ever be able to disagree.
   *
   * `search` narrows an already-scoped set: `branchScopeOf` alone decides
   * which cheques this caller may see, and no query parameter widens it.
   */
  async function listFilteredCheques(c: Context, filter: ChequeListFilter, asOfDate: string) {
    const { search, ...query } = filter;
    const rows = withinScope(await service.list({ ...query, asOfDate }), branchScopeOf(c), (ch) => ch.branchId);
    const term = search?.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (ch) =>
        ch.chequeNumber.toLowerCase().includes(term) ||
        ch.bankName.toLowerCase().includes(term) ||
        ch.partyId.toLowerCase().includes(term),
    );
  }

  app.get("/", gate("cheques.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const asOfDate = asOf();
    const cheques = await listFilteredCheques(c, parsed.filter, asOfDate);
    return c.json(cheques.map((cheque) => serialize(cheque, asOfDate)));
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   * Every other filter still applies.
   *
   * Counting is on the DERIVED 7-state status, the same one the rows carry —
   * قيد الانتظار / تحت التحصيل / المستحقة اليوم are three date-derived views of
   * one stored `pending`, so a pending cheque lands in exactly one of them.
   */
  app.get("/counts", gate("cheques.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const asOfDate = asOf();
    const { status: _ignored, ...withoutStatus } = parsed.filter;
    const cheques = await listFilteredCheques(c, withoutStatus, asOfDate);
    const counts: Record<string, number> = { all: cheques.length };
    for (const def of CHEQUE_STATUS_DEFINITIONS) counts[def.code] = 0;
    for (const cheque of cheques) {
      const effective = effectiveChequeStatus(cheque, asOfDate);
      counts[effective] = (counts[effective] ?? 0) + 1;
    }
    return c.json(counts);
  });

  /**
   * The KPI strip, summed in `Money` over the whole filtered set (R1.1) —
   * the screen used to add `Number(amount)` across the rows it happened to
   * hold. Unlike `/counts` this honours the status filter.
   *
   * `pending` and `deposited` are the STORED statuses, so `pending` covers the
   * تحت التحصيل and المستحقة اليوم views of it too: what is at stake here is
   * money not yet with the bank, which is the same money in all three.
   */
  app.get("/stats", gate("cheques.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const cheques = await listFilteredCheques(c, parsed.filter, asOf());
    let value = Money.zero();
    let pending = Money.zero();
    let deposited = Money.zero();
    for (const cheque of cheques) {
      value = value.add(cheque.amount);
      if (cheque.status === "pending") pending = pending.add(cheque.amount);
      if (cheque.status === "deposited") deposited = deposited.add(cheque.amount);
    }
    return c.json({
      count: cheques.length,
      value: value.toString(),
      pending: pending.toString(),
      deposited: deposited.toString(),
    });
  });

  app.get("/:id", gate("cheques.view"), async (c) => {
    const cheque = await service.findById(c.req.param("id"));
    if (!cheque) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(cheque, asOf()));
  });

  app.post("/", gate("cheques.create"), async (c) => {
    const parsed = createChequeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const d = parsed.data;
    try {
      const cheque = await service.createCheque({
        id: d.id ?? idGen(),
        direction: d.direction,
        chequeNumber: d.chequeNumber,
        bankName: d.bankName,
        bankBranchName: d.bankBranchName ?? null,
        bankAccountNumber: d.bankAccountNumber ?? null,
        amount: Money.fromMajor(d.amount),
        currency: d.currency,
        issueDate: d.issueDate,
        dueDate: d.dueDate,
        branchId: d.branchId,
        notes: d.notes ?? null,
        partyId: d.partyId,
        counterpartyGlAccountId: d.counterpartyGlAccountId,
        controlAccounts: { underCollectionAccountId: d.controlAccounts.underCollectionAccountId, bouncedAccountId: d.controlAccounts.bouncedAccountId ?? null },
        journalEntryId: idGen(),
      });
      return c.json(serialize(cheque, asOf()), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/deposit", gate("cheques.deposit"), async (c) => {
    const parsed = depositChequeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const cheque = await service.deposit({ chequeId: c.req.param("id"), bankTreasuryAccountId: parsed.data.bankTreasuryAccountId });
      return c.json(serialize(cheque, asOf()));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/collect", gate("cheques.collect"), async (c) => {
    const parsed = collectChequeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const cheque = await service.collect({
        chequeId: c.req.param("id"),
        bankGlAccountId: parsed.data.bankGlAccountId,
        date: parsed.data.date,
        journalEntryId: idGen(),
      });
      return c.json(serialize(cheque, asOf()));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/bounce", gate("cheques.bounce"), async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = bounceChequeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const cheque = await service.bounce({ chequeId: c.req.param("id"), date: parsed.data.date, journalEntryId: idGen() });
      return c.json(serialize(cheque, asOf()));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/replace", gate("cheques.create"), async (c) => {
    const parsed = replaceChequeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const d = parsed.data;
    try {
      const result = await service.replace({
        bouncedChequeId: c.req.param("id"),
        newCheque: {
          id: d.newCheque.id ?? idGen(),
          chequeNumber: d.newCheque.chequeNumber,
          bankName: d.newCheque.bankName,
          bankBranchName: d.newCheque.bankBranchName ?? null,
          bankAccountNumber: d.newCheque.bankAccountNumber ?? null,
          issueDate: d.newCheque.issueDate,
          dueDate: d.newCheque.dueDate,
          branchId: d.newCheque.branchId,
          notes: d.newCheque.notes ?? null,
        },
        date: d.date,
        journalEntryId: idGen(),
      });
      return c.json({ original: serialize(result.original, asOf()), replacement: serialize(result.replacement, asOf()) }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
