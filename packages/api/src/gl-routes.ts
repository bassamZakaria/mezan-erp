import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  createJournalEntry,
  postJournalEntry,
  postDraftJournalEntry,
  reverseJournalEntry,
  UnbalancedEntryError,
  InvalidJournalEntryError,
  AccountNotFoundError,
  HeaderAccountNotPostableError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  InactiveAccountError,
  DuplicateJournalEntryError,
  JournalEntryNotFoundError,
  JournalEntryNotDraftError,
  JournalEntryNotPostedError,
  JournalEntryAlreadyReversedError,
  type JournalEntry,
  type JournalPostingDeps,
  type LedgerRepository,
  type AccountBalance,
  type AccountLedgerLine,
  type AccountRepository,
  type FiscalPeriodRepository,
  type NextNumberService,
  type AuditSink,
  type GlEventPublisher,
} from "@mezan/domain";
import {
  createGlJournalEntrySchema,
  reverseGlJournalEntrySchema,
  glJournalListQuerySchema,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

/** External dependencies the GL routes bind the posting engine to. */
export interface GlRoutesDeps {
  readonly ledger: LedgerRepository;
  readonly accounts: Pick<AccountRepository, "findById">;
  readonly periods: Pick<FiscalPeriodRepository, "findByDate">;
  readonly numbering: NextNumberService;
  readonly audit?: AuditSink;
  readonly events?: GlEventPublisher;
  readonly now?: () => string;
  /** Generates a reversing-entry id when the request body omits one. Defaults to a UUID. */
  readonly idGen?: () => string;
}

function serialize(entry: JournalEntry) {
  return {
    id: entry.id,
    entryNo: entry.entryNo ?? null,
    date: entry.date,
    memo: entry.memo,
    status: entry.status,
    source: entry.source ?? "manual",
    createdAt: entry.createdAt ?? null,
    postedAt: entry.postedAt ?? null,
    reversesEntryId: entry.reversesEntryId ?? null,
    reversedByEntryId: entry.reversedByEntryId ?? null,
    lines: entry.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
      memo: l.memo ?? null,
    })),
  };
}

function serializeBalance(balance: AccountBalance) {
  return {
    accountId: balance.accountId,
    debit: balance.debit.toString(),
    credit: balance.credit.toString(),
    balance: balance.balance.toString(),
  };
}

function serializeLedgerLine(line: AccountLedgerLine) {
  return {
    entryId: line.entryId,
    entryNo: line.entryNo,
    date: line.date,
    memo: line.memo,
    debit: line.debit.toString(),
    credit: line.credit.toString(),
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof UnbalancedEntryError) {
    return c.json(
      {
        error: err.code,
        message: err.message,
        totalDebit: err.totalDebit.toString(),
        totalCredit: err.totalCredit.toString(),
      },
      422,
    );
  }
  if (err instanceof InvalidJournalEntryError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof JournalEntryNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (
    err instanceof DuplicateJournalEntryError ||
    err instanceof JournalEntryNotDraftError ||
    err instanceof JournalEntryNotPostedError ||
    err instanceof JournalEntryAlreadyReversedError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  throw err;
}

/**
 * GL posting routes (docs/catalog/04 §القيود المحاسبية), mounted under `/gl`:
 *   POST /journal-entries            create + post in one step (post gate)
 *   POST /journal-entries/draft      save a draft            (create gate)
 *   POST /journal-entries/:id/post   post an existing draft  (post gate)
 *   POST /journal-entries/:id/reverse  reverse a posted entry (post gate)
 *   GET  /journal-entries            list (status/source/date filters) (view gate)
 *   GET  /journal-entries/:id        get one                 (view gate)
 *   GET  /accounts/:accountId/ledger account balance + movements (view gate)
 *
 * PERMISSION NOTE: the catalog defines accounting.journal.view/.create/.post/
 * .approve (permissions/catalog.ts). There is no dedicated "reverse" permission;
 * reversing is a money-reversing posting action, so `/reverse` reuses
 * `accounting.journal.post`.
 */
export function createGlRoutes(
  deps: GlRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  function postingDeps(c: Context): JournalPostingDeps {
    return {
      ledger: deps.ledger,
      accounts: deps.accounts,
      periods: deps.periods,
      numbering: deps.numbering,
      audit: deps.audit,
      events: deps.events,
      now: deps.now,
      actor: getAuthContext(c)?.userId ?? "system",
    };
  }

  app.post("/journal-entries", gate("accounting.journal.post"), async (c) => {
    const parsed = createGlJournalEntrySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const entry = await postJournalEntry(
        {
          id: parsed.data.id,
          date: parsed.data.date,
          memo: parsed.data.memo,
          source: parsed.data.source,
          lines: parsed.data.lines.map((l) => ({
            accountId: l.accountId,
            debit: Money.fromMajor(l.debit),
            credit: Money.fromMajor(l.credit),
            memo: l.memo ?? null,
          })),
        },
        postingDeps(c),
      );
      return c.json(serialize(entry), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/journal-entries/draft", gate("accounting.journal.create"), async (c) => {
    const parsed = createGlJournalEntrySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const entry = await createJournalEntry(
        {
          id: parsed.data.id,
          date: parsed.data.date,
          memo: parsed.data.memo,
          source: parsed.data.source,
          lines: parsed.data.lines.map((l) => ({
            accountId: l.accountId,
            debit: Money.fromMajor(l.debit),
            credit: Money.fromMajor(l.credit),
            memo: l.memo ?? null,
          })),
        },
        postingDeps(c),
      );
      return c.json(serialize(entry), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/journal-entries/:id/post", gate("accounting.journal.post"), async (c) => {
    try {
      const entry = await postDraftJournalEntry(c.req.param("id"), postingDeps(c));
      return c.json(serialize(entry));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/journal-entries/:id/reverse", gate("accounting.journal.post"), async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = reverseGlJournalEntrySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await reverseJournalEntry(c.req.param("id"), postingDeps(c), {
        reversalId: parsed.data.reversalId ?? idGen(),
        date: parsed.data.date,
        memo: parsed.data.memo,
      });
      return c.json(
        { original: serialize(result.original), reversal: serialize(result.reversal) },
        201,
      );
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/journal-entries", gate("accounting.journal.view"), async (c) => {
    const parsed = glJournalListQuerySchema.safeParse({
      status: c.req.query("status"),
      source: c.req.query("source"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const entries = await deps.ledger.list(parsed.data);
    return c.json(entries.map(serialize));
  });

  app.get("/journal-entries/:id", gate("accounting.journal.view"), async (c) => {
    const entry = await deps.ledger.findById(c.req.param("id"));
    if (!entry) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(entry));
  });

  app.get("/accounts/:accountId/ledger", gate("accounting.journal.view"), async (c) => {
    const accountId = c.req.param("accountId");
    const asOf = c.req.query("asOf");
    const balance = await deps.ledger.accountBalance(accountId, asOf);
    const lines = await deps.ledger.accountLedger(accountId, asOf);
    return c.json({
      balance: serializeBalance(balance),
      lines: lines.map(serializeLedgerLine),
    });
  });

  return app;
}
