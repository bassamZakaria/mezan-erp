import { postingRefusalResponse } from "./posting-refusal.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  type ForeignTreasuryBalance,
  Money,
  createJournalEntry,
  postJournalEntry,
  postDraftJournalEntry,
  replaceDraftJournalEntry,
  deleteDraftJournalEntry,
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
  PartyRequiredOnControlAccountError,
  InvalidJournalPartyError,
  ReversalDateBeforeOriginalError,
  JournalEntryOwnedByDocumentError,
  JournalReversalNotReversibleError,
  assertReversibleFromJournal,
  type PartyControlKind,
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
  planYearEndClose,
  YearAlreadyClosedError,
  YearNotClosedError,
  FollowingYearClosedError,
  reopenFiscalYear,
  standingYearClose,
  NothingToCloseError,
  recordVatFiling,
  amendVatFiling,
  DuplicateVatFilingError,
  VatFilingNotFoundError,
  type VatFiling,
  type VatFilingRepository,
  matchesSearch,
  summarizePartyBalancesByCurrency,
  type OpenPartyDocument,
  type CurrencyBalanceGroup,
} from "@mezan/domain";
import { tenantDay } from "./tenant-day.js";
import { readReversalRequest, requireReversalReason } from "./document-reversal.js";
import {
  ReversalPermission,
  createGlJournalEntrySchema,
  updateGlJournalEntrySchema,
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
  /** So a manual entry's `projectId` names a project that exists (D-01). */
  readonly projects?: JournalPostingDeps["projects"];
  /**
   * Accounts whose lines must name a project — the routed contracting control
   * and cost slots. The hand-written journal is exactly where an unattributed
   * movement on 1230 or 2160 gets in.
   */
  readonly projectRequiredAccountIds?: JournalPostingDeps["projectRequiredAccountIds"];
  /**
   * The party control accounts, read per request because the routing is
   * tenant configuration (D205). A hand-written line on one must name its
   * customer or supplier.
   */
  readonly resolvePartyControlAccounts?: () => Promise<ReadonlyMap<string, PartyControlKind>>;
  readonly partyExists?: JournalPostingDeps["partyExists"];
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
  readonly treasuryCurrencyBalances?: () => Promise<readonly ForeignTreasuryBalance[]>;
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
    reversibleFromJournal: reversibleFromJournal(entry),
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
      taxRateId: l.taxRateId ?? null,
      projectId: l.projectId ?? null,
      costCategory: l.costCategory ?? null,
      branchId: l.branchId ?? null,
      partyId: l.partyId ?? null,
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
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
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
  if (err instanceof PartyRequiredOnControlAccountError || err instanceof InvalidJournalPartyError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, accountId: err.accountId }, 422);
  }
  if (err instanceof ReversalDateBeforeOriginalError || err instanceof JournalEntryOwnedByDocumentError || err instanceof JournalReversalNotReversibleError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
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
  if (err instanceof YearNotClosedError || err instanceof FollowingYearClosedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
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
 * GL posting routes (docs/archive/catalog/04 §القيود المحاسبية), mounted under `/gl`:
 *   POST /journal-entries            create + post in one step (post gate)
 *   POST /journal-entries/draft      save a draft            (create gate)
 *   PUT  /journal-entries/:id        edit an existing draft  (create gate)
 *   DELETE /journal-entries/:id      delete an existing draft (create gate)
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
function reversibleFromJournal(entry: Parameters<typeof assertReversibleFromJournal>[0]): boolean {
  try {
    assertReversibleFromJournal(entry);
    return true;
  } catch (err) {
    if (err instanceof JournalEntryOwnedByDocumentError || err instanceof JournalReversalNotReversibleError) return false;
    throw err;
  }
}

export function createGlRoutes(
  deps: GlRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  async function manualPostingDeps(c: Context): Promise<JournalPostingDeps> {
    return {
      ...postingDeps(c),
      partyControlAccounts: await deps.resolvePartyControlAccounts?.(),
      partyExists: deps.partyExists,
    };
  }

  function postingDeps(c: Context): JournalPostingDeps {
    return {
      ledger: deps.ledger,
      accounts: deps.accounts,
      periods: deps.periods,
      vatFilings: deps.vatFilings,
      numbering: deps.numbering,
      projects: deps.projects,
      projectRequiredAccountIds: deps.projectRequiredAccountIds,
      audit: deps.audit,
      events: deps.events,
      now: deps.now,
      actor: getAuthContext(c)?.userId ?? "system",
    };
  }

  /**
   * The accounts on which a hand-written line must name its customer or
   * supplier (D205), so the journal screen can ask for the party before the
   * post is refused.
   */
  app.get("/party-control-accounts", gate("accounting.journal.view"), async (c) => {
    const controls = (await deps.resolvePartyControlAccounts?.()) ?? new Map<string, PartyControlKind>();
    return c.json([...controls].map(([accountId, partyKind]) => ({ accountId, partyKind })));
  });

  app.post("/journal-entries", gate("accounting.journal.post"), async (c) => {
    const parsed = createGlJournalEntrySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const entry = await postJournalEntry(
        {
          id: parsed.data.id,
          date: await tenantDay(c, parsed.data.date),
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
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
            branchId: l.branchId ?? null,
            partyId: l.partyId ?? null,
          })),
        },
        await manualPostingDeps(c),
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
   * Whether a year has been closed, and by which entry. A year not yet closed
   * is a normal state, so it answers 200 with `entry: null` rather than a 404.
   */
  app.get("/year-end-close/:year", gate("accounting.journal.view"), async (c) => {
    const year = Number(c.req.param("year"));
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      return c.json({ error: "VALIDATION_ERROR", message: "سنة غير صالحة." }, 400);
    }
    const entry = await standingYearClose(deps.ledger, year);
    const followingClosed = (await standingYearClose(deps.ledger, year + 1)) !== null;
    return c.json({ year, closed: entry !== null, reopenable: entry !== null && !followingClosed, entry: entry ? serialize(entry) : null });
  });

  /**
   * What closing the year WOULD post, without posting it. The screen shows this
   * before the button is pressed, and it runs the same `planYearEndClose` the
   * close itself runs — so a preview that disagreed with the entry is not a
   * shape this can take. A year already closed answers 409 here too, which is
   * how the screen knows to show the posted entry instead of the button.
   */
  app.get("/year-end-close/:year/preview", gate("accounting.period.close"), async (c) => {
    const year = Number(c.req.param("year"));
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      return c.json({ error: "VALIDATION_ERROR", message: "سنة غير صالحة." }, 400);
    }
    try {
      const plan = await planYearEndClose(
        // The preview never posts, so the retained-earnings account it would
        // credit is irrelevant to the figures — the P&L side is the whole plan.
        { year, retainedEarningsAccountId: "" },
        { ...postingDeps(c), ledger: deps.ledger, accounts: deps.accounts },
      );
      return c.json({
        year: plan.year,
        entryId: plan.entryId,
        date: plan.date,
        netResult: plan.netResult.toString(),
        revenueClosed: plan.revenueClosed.toString(),
        expensesClosed: plan.expensesClosed.toString(),
        lines: plan.lines.map((line) => ({
          accountId: line.accountId,
          accountCode: line.accountCode,
          accountNameAr: line.accountNameAr,
          accountType: line.accountType,
          projectId: line.projectId,
          debit: line.debit.toString(),
          credit: line.credit.toString(),
        })),
      });
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

  app.post("/year-end-close/:year/reopen", gate(ReversalPermission.YearEndClose), requireReversalReason, async (c) => {
    const year = Number(c.req.param("year"));
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      return c.json({ error: "VALIDATION_ERROR", message: "سنة غير صالحة.", messageEn: "Invalid year." }, 400);
    }
    try {
      const { memo } = await readReversalRequest(c);
      const result = await reopenFiscalYear(year, { ...postingDeps(c), ledger: deps.ledger, accounts: deps.accounts }, { reversalId: idGen(), memo });
      return c.json({ year, journalEntryId: result.journalEntryId, reversalEntryId: result.reversal.id, reversalEntryNo: result.reversal.entryNo ?? null, reversalDate: result.reversal.date }, 201);
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
          date: await tenantDay(c, parsed.data.date),
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
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
            branchId: l.branchId ?? null,
            partyId: l.partyId ?? null,
          })),
        },
        await manualPostingDeps(c),
      );
      return c.json(serialize(entry), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/journal-entries/:id/post", gate("accounting.journal.post"), async (c) => {
    try {
      const entry = await postDraftJournalEntry(c.req.param("id"), await manualPostingDeps(c));
      return c.json(serialize(entry));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * Edit a مسودة (draft) entry in place (D226): a draft saved before the D205
   * party rule existed, or any other draft, is stuck otherwise — there is no
   * other route that can change a line once saved. Refused 409 on anything
   * that is not a draft; a posted or reversed entry is corrected only by
   * reversal.
   */
  app.put("/journal-entries/:id", gate("accounting.journal.create"), async (c) => {
    const parsed = updateGlJournalEntrySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const entry = await replaceDraftJournalEntry(
        c.req.param("id"),
        {
          date: await tenantDay(c, parsed.data.date),
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
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
            branchId: l.branchId ?? null,
            partyId: l.partyId ?? null,
          })),
        },
        await manualPostingDeps(c),
      );
      return c.json(serialize(entry));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /** Delete a مسودة (draft) entry (D226). Refused 409 on anything that is not a draft. */
  app.delete("/journal-entries/:id", gate("accounting.journal.create"), async (c) => {
    try {
      await deleteDraftJournalEntry(c.req.param("id"), postingDeps(c));
      return c.body(null, 204);
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
      const entryId = c.req.param("id");
      const resolvedDate = await tenantDay(c, parsed.data.date ?? (deps.now ? deps.now() : new Date().toISOString()));
      // A reversal dated before the entry's own day would restate a day
      // already reported (D270). Checked only for THIS manual-reversal route
      // — a depreciation run or a purchase-invoice cancel calls
      // `reverseJournalEntry` directly with its own date semantics and is
      // gated by the period lock alone.
      const existing = await deps.ledger.findById(entryId);
      if (existing) assertReversibleFromJournal(existing);
      if (existing && resolvedDate < existing.date) {
        throw new ReversalDateBeforeOriginalError(entryId, resolvedDate, existing.date);
      }
      const result = await reverseJournalEntry(entryId, postingDeps(c), {
        reversalId: parsed.data.reversalId ?? idGen(),
        // No date sent (D270) defaults to today, in the tenant's own
        // calendar day, never the entry's own day. `deps.now`, not a raw
        // `new Date()`, so it stays the same injectable clock `postingDeps`
        // already uses for this route.
        date: resolvedDate,
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
    readonly page: number;
    readonly pageSize: number;
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
      search: c.req.query("search") || undefined,
      page: c.req.query("page"),
      pageSize: c.req.query("pageSize"),
    });
    if (!parsed.success) return { ok: false, details: parsed.error.flatten() };
    return { ok: true, filter: parsed.data };
  }

  /**
   * The one filter the rows, the chip counts and the KPI strip all go through
   * (R1.1). Nothing else selects journal rows, so the register, its chips and
   * its debit/credit totals cannot disagree.
   */
  async function listFilteredJournalEntries(
    filter: JournalListFilter,
    page?: { limit: number; offset: number },
  ): Promise<readonly JournalEntry[]> {
    const { sourceModule, search, ...ledgerFilter } = filter;
    // `search` reaches the store as SQL AND is re-applied below: the store's
    // clause narrows the page, the JS pass keeps a ledger that cannot express
    // it honest. `sourceModule` is derived from the document type through a
    // mapping SQL does not hold, so a request carrying either of the two JS
    // filters is paged after them — a LIMIT ahead of a filter is a wrong page,
    // not a fast one.
    const pagedInSql = page !== undefined && !sourceModule;
    let entries = await deps.ledger.list({
      ...ledgerFilter,
      ...(search ? { search } : {}),
      ...(pagedInSql ? page : {}),
    });
    if (sourceModule) entries = entries.filter((e) => journalSourceModule(e.sourceDocType, e.source) === sourceModule);
    if (search) entries = entries.filter((e) => matchesSearch(search, e.entryNo, e.memo, e.sourceDocNumber));
    if (page && !pagedInSql) entries = entries.slice(page.offset, page.offset + page.limit);
    return entries;
  }

  app.get("/journal-entries", gate("accounting.journal.view"), async (c) => {
    const parsed = parseJournalListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const { page, pageSize } = parsed.filter;
    const rows = await listFilteredJournalEntries(parsed.filter, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return c.json(rows.map(serialize));
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
    const key = c.req.param("id");
    // The register addresses an entry by its number (`/money/journals/JE-000100`).
    const entry =
      (await deps.ledger.findById(key)) ?? (await deps.ledger.list({ search: key })).find((e) => e.entryNo === key) ?? null;
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
      treasury: ((await deps.treasuryCurrencyBalances?.()) ?? []).map((row) => ({
        treasuryAccountId: row.treasuryAccountId,
        name: row.name,
        glAccountId: row.glAccountId,
        currency: row.currency,
        foreignBalance: row.foreignBalance.toString(),
        baseBalance: row.baseBalance.toString(),
        derivedLines: row.derivedLines,
      })),
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
