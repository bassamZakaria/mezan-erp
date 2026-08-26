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
  journalSourceModule,
  closeFiscalYear,
  YearAlreadyClosedError,
  NothingToCloseError,
  recordVatFiling,
  amendVatFiling,
  VatPeriodAlreadyFiledError,
  DuplicateVatFilingError,
  VatFilingNotFoundError,
  type VatFiling,
  type VatFilingRepository,
  matchesSearch,
  summarizePartyBalancesByCurrency,
  type OpenPartyDocument,
  type CurrencyBalanceGroup,
} from "@mezan/domain";
import {
  createGlJournalEntrySchema,
  reverseGlJournalEntrySchema,
  glJournalListQuerySchema,
  type GlJournalListQueryDTO,
  closeFiscalYearSchema,
  recordVatFilingSchema,
  amendVatFilingSchema,
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
  readonly accounts: Pick<AccountRepository, "findById" | "list">;
  /** Filed VAT returns; when omitted no filing is recorded and nothing is locked. */
  readonly vatFilings?: VatFilingRepository;
  readonly periods: Pick<FiscalPeriodRepository, "findByDate">;
  readonly numbering: NextNumberService;
  readonly audit?: AuditSink;
  readonly events?: GlEventPublisher;
  readonly now?: () => string;
  /** Generates a reversing-entry id when the request body omits one. Defaults to a UUID. */
  readonly idGen?: () => string;
  /**
   * Every open receivable and payable with the currency it was raised in and
   * the rate it was booked at — the input to `GET /gl/balances-by-currency`
   * (R1.16). Omit and the endpoint reports empty rather than pretending every
   * balance is base-currency.
   */
  readonly openPartyDocuments?: () => Promise<readonly OpenPartyDocument[]>;
  /** The tenant's base currency; defaults to EGP. */
  readonly baseCurrency?: () => Promise<string> | string;
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
    sourceDocType: entry.sourceDocType ?? null,
    sourceDocId: entry.sourceDocId ?? null,
    sourceDocNumber: entry.sourceDocNumber ?? null,
    // Derived, not stored: a module recorded beside the document type is a
    // second source of truth that can disagree with it (R6.3).
    sourceModule: journalSourceModule(entry.sourceDocType, entry.source),
    lines: entry.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
      memo: l.memo ?? null,
      costCenterId: l.costCenterId ?? null,
      currency: l.currency ?? null,
      fxRate: l.fxRate ?? null,
      taxRatePercent: l.taxRatePercent ?? null,
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

function serializeCurrencyGroup(group: CurrencyBalanceGroup) {
  return {
    currency: group.currency,
    outstandingBase: group.outstandingBase.toString(),
    outstandingTransaction: group.outstandingTransaction.toString(),
    parties: group.parties.map((p) => ({
      partyId: p.partyId,
      partyName: p.partyName,
      currency: p.currency,
      outstandingBase: p.outstandingBase.toString(),
      outstandingTransaction: p.outstandingTransaction.toString(),
      documentCount: p.documentCount,
    })),
  };
}

function serializeFiling(f: VatFiling) {
  return {
    id: f.id,
    periodFrom: f.periodFrom,
    periodTo: f.periodTo,
    netAmount: f.netAmount.toString(),
    referenceNo: f.referenceNo,
    status: f.status,
    filedAt: f.filedAt,
    filedBy: f.filedBy,
    amendedAt: f.amendedAt,
    amendmentReason: f.amendmentReason,
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
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof DuplicateVatFilingError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof VatFilingNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof YearAlreadyClosedError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof NothingToCloseError) {
    return c.json({ error: err.code, message: err.message }, 422);
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
      vatFilings: deps.vatFilings,
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
            costCenterId: l.costCenterId ?? null,
            taxRatePercent: l.taxRatePercent ?? null,
            currency: l.currency ?? null,
            fxRate: l.fxRate ?? null,
          })),
        },
        postingDeps(c),
      );
      return c.json(serialize(entry), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * الإقرارات الضريبية المقدَّمة — the record that a period's VAT return went to
   * the authority, and the lock that stops a backdated document restating it
   * without anyone deciding to (D29).
   */
  app.get("/vat-filings", gate("accounting.reports.view"), async (c) => {
    if (!deps.vatFilings) return c.json([]);
    return c.json((await deps.vatFilings.list()).map(serializeFiling));
  });

  app.post("/vat-filings", gate("accounting.period.close"), async (c) => {
    if (!deps.vatFilings) return c.json({ error: "NOT_FOUND" }, 404);
    const parsed = recordVatFilingSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const filing = await recordVatFiling(
        {
          id: parsed.data.id,
          periodFrom: parsed.data.periodFrom,
          periodTo: parsed.data.periodTo,
          netAmount: Money.fromMajor(parsed.data.netAmount),
          referenceNo: parsed.data.referenceNo ?? null,
          filedBy: getAuthContext(c)?.userId ?? "system",
        },
        { filings: deps.vatFilings },
      );
      return c.json(serializeFiling(filing), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/vat-filings/:id/amend", gate("accounting.period.close"), async (c) => {
    if (!deps.vatFilings) return c.json({ error: "NOT_FOUND" }, 404);
    const parsed = amendVatFilingSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const filing = await amendVatFiling(c.req.param("id"), parsed.data.reason, { filings: deps.vatFilings });
      return c.json(serializeFiling(filing));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * إقفال السنة المالية — moves every revenue and expense balance into retained
   * earnings, so the new year opens with the P&L accounts at zero and the
   * ledger itself states last year's result (D34). Idempotent by id: closing
   * the same year twice is refused rather than posted twice.
   */
  app.post("/year-end-close", gate("accounting.period.close"), async (c) => {
    const parsed = closeFiscalYearSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await closeFiscalYear(
        {
          year: parsed.data.year,
          retainedEarningsAccountId: parsed.data.retainedEarningsAccountId,
          memo: parsed.data.memo,
        },
        { ...postingDeps(c), ledger: deps.ledger, accounts: deps.accounts },
      );
      return c.json({
        journalEntryId: result.journalEntryId,
        year: parsed.data.year,
        netResult: result.netResult.toString(),
        revenueClosed: result.revenueClosed.toString(),
        expensesClosed: result.expensesClosed.toString(),
        accountsClosed: result.accountsClosed,
      }, 201);
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
            costCenterId: l.costCenterId ?? null,
            taxRatePercent: l.taxRatePercent ?? null,
            currency: l.currency ?? null,
            fxRate: l.fxRate ?? null,
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

  interface JournalListFilter {
    readonly status?: GlJournalListQueryDTO["status"];
    readonly source?: GlJournalListQueryDTO["source"];
    readonly sourceModule?: GlJournalListQueryDTO["sourceModule"];
    readonly fromDate?: string;
    readonly toDate?: string;
    readonly search?: string;
  }

  function parseJournalListQuery(
    c: Context,
  ): { ok: true; filter: JournalListFilter } | { ok: false; details: unknown } {
    const status = c.req.query("status");
    const parsed = glJournalListQuerySchema.safeParse({
      // `all` is the chip key for "no status filter", not a stored status —
      // forwarding it to the ledger would match nothing.
      status: status && status !== "all" ? status : undefined,
      source: c.req.query("source"),
      sourceModule: c.req.query("sourceModule"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) return { ok: false, details: parsed.error.flatten() };
    return { ok: true, filter: { ...parsed.data, search: c.req.query("search") || undefined } };
  }

  /**
   * The one filter the rows, the chip counts and the KPI strip all go through
   * (R1.1). Nothing else selects journal rows, so the register, its chips and
   * its debit/credit totals cannot disagree.
   */
  async function listFilteredJournalEntries(filter: JournalListFilter): Promise<readonly JournalEntry[]> {
    const { sourceModule, search, ...ledgerFilter } = filter;
    let entries = await deps.ledger.list(ledgerFilter);
    if (sourceModule) entries = entries.filter((e) => journalSourceModule(e.sourceDocType, e.source) === sourceModule);
    if (search) entries = entries.filter((e) => matchesSearch(search, e.entryNo, e.memo, e.sourceDocNumber));
    return entries;
  }

  app.get("/journal-entries", gate("accounting.journal.view"), async (c) => {
    const parsed = parseJournalListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    return c.json((await listFilteredJournalEntries(parsed.filter)).map(serialize));
  });

  /**
   * The status chips. Deliberately drops its own `status` axis: a chip states
   * how many rows it WOULD show, so counting the already status-filtered set
   * renders every chip but the active one as zero. The module, source, date
   * and search filters still apply.
   */
  app.get("/journal-entries/counts", gate("accounting.journal.view"), async (c) => {
    const parsed = parseJournalListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const { status: _ignored, ...withoutStatus } = parsed.filter;
    const entries = await listFilteredJournalEntries(withoutStatus);
    const counts: Record<string, number> = {
      all: entries.length,
      draft: 0,
      pending: 0,
      posted: 0,
      reversed: 0,
    };
    for (const entry of entries) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    return c.json(counts);
  });

  /**
   * The KPI strip. Unlike `/counts` this DOES honour the status filter. Debit
   * and credit are summed in `Money` (bigint, scale 1e-6) and must tie to the
   * cent — a register whose two headline totals disagree is reporting an
   * unbalanced book, which double entry does not permit.
   */
  app.get("/journal-entries/stats", gate("accounting.journal.view"), async (c) => {
    const parsed = parseJournalListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const entries = await listFilteredJournalEntries(parsed.filter);
    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    for (const entry of entries) {
      for (const line of entry.lines) {
        totalDebit = totalDebit.add(line.debit);
        totalCredit = totalCredit.add(line.credit);
      }
    }
    return c.json({
      count: entries.length,
      draft: entries.filter((e) => e.status === "draft").length,
      posted: entries.filter((e) => e.status === "posted").length,
      reversed: entries.filter((e) => e.status === "reversed").length,
      totalDebit: totalDebit.toString(),
      totalCredit: totalCredit.toString(),
    });
  });

  app.get("/journal-entries/:id", gate("accounting.journal.view"), async (c) => {
    const entry = await deps.ledger.findById(c.req.param("id"));
    if (!entry) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(entry));
  });

  /**
   * أرصدة العملاء والموردين حسب العملة (R1.16). The base figure is what the
   * AR/AP control accounts hold; the transaction figure is what the customer
   * or supplier actually owes, in the currency the document was raised in.
   */
  app.get("/balances-by-currency", gate("accounting.reports.view"), async (c) => {
    const baseCurrency = (await deps.baseCurrency?.()) ?? "EGP";
    const documents = (await deps.openPartyDocuments?.()) ?? [];
    const report = summarizePartyBalancesByCurrency(documents, baseCurrency);
    return c.json({
      baseCurrency: report.baseCurrency,
      receivables: report.receivables.map(serializeCurrencyGroup),
      payables: report.payables.map(serializeCurrencyGroup),
      receivableTotalBase: report.receivableTotalBase.toString(),
      payableTotalBase: report.payableTotalBase.toString(),
    });
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
