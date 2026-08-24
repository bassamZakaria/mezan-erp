import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  ChequeService,
  Money,
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
} from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";

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
 * Cheque register routes (docs/catalog/04 §"سجل الشيكات"), mounted under `/cheques`:
 *   GET  /cheques                  list (direction/status/date filters)  cheques.view
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
export function createChequesRoutes(deps: ChequeRoutesDeps, resolveAuthContext: AuthContextResolver = headerAuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());
  const service = new ChequeService(deps);
  const asOf = () => (deps.now ? deps.now() : new Date().toISOString()).slice(0, 10);

  app.get("/", gate("cheques.view"), async (c) => {
    const parsed = chequeListQuerySchema.safeParse({
      direction: c.req.query("direction"),
      status: c.req.query("status"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const asOfDate = asOf();
    const cheques = withinScope(await service.list({ ...parsed.data, asOfDate }), branchScopeOf(c), (ch) => ch.branchId);
    return c.json(cheques.map((cheque) => serialize(cheque, asOfDate)));
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
