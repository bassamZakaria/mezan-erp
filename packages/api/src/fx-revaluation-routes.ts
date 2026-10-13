import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  FX_REVALUATION_ALL_CURRENCIES,
  computeFxRevaluation,
  postFxRevaluation,
  deriveOpenFxBalances,
  withDerivedTreasuryFx,
  type DerivedTreasuryFxLine,
  nextDay,
  reverseJournalEntry,
  FX_REVALUATION_DOC_TYPE,
  ReversalDateBeforeOriginalError,
  FxRateMissingError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  type AccountRepository,
  type ExchangeRateRepository,
  type FxDifferenceAccounts,
  type FxRevaluationConfig,
  type FxRevaluationResult,
  type JournalPostingDeps,
  type LedgerRepository,
  type OpenFxBalance,
  type OpenFxItem,
  type FxRevaluationShare,
  type ForeignResidue,
  type JournalLineInput,
  ForeignResidueKind,
  FxOpenItemType,
  type FxOpenItemRef,
  FX_REVALUATION_LINE_MEMO,
  FX_REALISED_LINE_MEMO,
  FX_REALISED_DOC_TYPE,
  Money,
  isRoundingResidue,
  postJournalEntry,
} from "@mezan/domain";
import { ReversalPermission, fxRevaluationRequestSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { tenantDay } from "./tenant-day.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";
import { readReversalRequest, recordDocumentReversal, reversalRefusalResponse, requireReversalReason } from "./document-reversal.js";

export interface FxRevaluationRoutesDeps {
  readonly ledger: LedgerRepository;
  readonly accounts: AccountRepository;
  readonly periods: JournalPostingDeps["periods"];
  readonly numbering: JournalPostingDeps["numbering"];
  readonly projects?: JournalPostingDeps["projects"];
  readonly exchangeRates: ExchangeRateRepository;
  /** Where the unrealised gain and loss post, read per request so the tenant's `fx.unrealised_*` routing applies (D229). */
  differenceAccounts(): Promise<FxDifferenceAccounts>;
  readonly audit?: JournalPostingDeps["audit"];
  readonly vatFilings?: JournalPostingDeps["vatFilings"];
  readonly events?: JournalPostingDeps["events"];
  readonly now?: () => string;
  readonly idGen?: () => string;
  readonly recordRun?: (run: FxRevaluationRun) => void;
  readonly openFxItems?: (asOfDate: string) => Promise<ReadonlyMap<string, readonly OpenFxItem[]>>;
  readonly saveShares?: (entryId: string, shares: readonly FxRevaluationShare[]) => Promise<void>;
  readonly shareConsumer?: (entryId: string) => Promise<string | null>;
  readonly releaseSharesRelievedSince?: (asOfDate: string, shares: readonly FxRevaluationShare[]) => Promise<void>;
  readonly foreignResidues?: (asOfDate?: string) => Promise<readonly ForeignResidue[]>;
  readonly realisedDifferenceAccounts?: () => Promise<FxDifferenceAccounts>;
  readonly releaseItemShare?: (item: FxOpenItemRef, date: string) => Promise<void>;
  readonly foreignTreasuryCurrencies?: () => Promise<ReadonlyMap<string, string>>;
}

function serializeResult(computed: FxRevaluationResult, date: string, autoReverse: boolean, derived: readonly DerivedTreasuryFxLine[] = []) {
  return {
    date,
    autoReverse,
    derivedTreasuryLines: derived.map((line) => ({
      entryId: line.entryId,
      accountId: line.accountId,
      date: line.date,
      currency: line.currency,
      fxRate: line.fxRate,
      foreignAmount: line.foreignAmount.toString(),
    })),
    reversalDate: nextDay(date),
    details: computed.details.map((d) => ({
      accountId: d.accountId,
      currency: d.currency,
      label: d.label,
      foreignAmount: d.foreignAmount.toString(),
      bookedBase: d.bookedBase.toString(),
      closingRate: d.closingRate,
      revaluedBase: d.revaluedBase.toString(),
      delta: d.delta.toString(),
      gainLoss: d.gainLoss.toString(),
    })),
    totalGain: computed.totalGain.toString(),
    totalLoss: computed.totalLoss.toString(),
    hasImpact: computed.hasImpact,
  };
}

function handleError(c: Context, err: unknown): Response {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const reversalRefusal = reversalRefusalResponse(c, err);
  if (reversalRefusal) return reversalRefusal;
  if (err instanceof FxRateMissingError) {
    return c.json({ error: err.code, message: err.message, currency: err.currency }, 422);
  }
  if (err instanceof NoFiscalPeriodForDateError || err instanceof PeriodNotOpenForPostingError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * إعادة تقييم العملات الأجنبية — FX Revaluation (docs/archive/catalog/04), mounted under
 * `/revaluation`:
 *   POST /preview  — معاينة: compute the revaluation without posting.
 *   POST /post     — post the FX gain/loss entry (+ next-day auto-reversal).
 * Permission: `accounting.journal.post` (it posts a journal entry).
 */
export interface FxRevaluationRun {
  readonly asOfDate: string;
  readonly currencies: readonly string[];
  readonly entryId: string | null;
  readonly ranBy: string;
  readonly ranAt: string;
}

export function createFxRevaluationRoutes(
  deps: FxRevaluationRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  async function build(date: string, currencyFilter?: readonly string[], attribute = false): Promise<{ balances: OpenFxBalance[]; config: FxRevaluationConfig; derived: DerivedTreasuryFxLine[] }> {
    const posted = (await deps.ledger.listLines?.({ toDate: date })) ?? [];
    const { lines, derived } = await withDerivedTreasuryFx(posted, (await deps.foreignTreasuryCurrencies?.()) ?? new Map(), async (currency, on) => (await deps.exchangeRates.findRate(currency, on))?.rate ?? null);
    const accounts = await deps.accounts.list();
    const filterSet = currencyFilter && currencyFilter.length > 0 ? new Set(currencyFilter) : undefined;
    const balances = deriveOpenFxBalances(lines, accounts, filterSet);
    // Strict fx-rate-missing policy: resolve one closing rate per currency; a
    // missing one is simply absent from the map so compute throws for it.
    const closingRates = new Map<string, string>();
    for (const currency of new Set(balances.map((b) => b.currency))) {
      const rate = await deps.exchangeRates.findRate(currency, date);
      if (rate) closingRates.set(currency, rate.rate);
    }
    const reported = filterSet ? derived.filter((line) => filterSet.has(line.currency)) : derived;
    const openItems = attribute ? await deps.openFxItems?.(date) : undefined;
    return { balances, config: { date, closingRates, ...(await deps.differenceAccounts()), ...(openItems ? { openItems } : {}) }, derived: reported };
  }

  enum HeldRunAction {
    Post = "post",
    Reverse = "reverse",
  }

  class LaterRevaluationStandsError extends Error {
    constructor(readonly entryNo: string, readonly runDate: string, readonly action: HeldRunAction) {
      super(
        action === HeldRunAction.Post
          ? `لا يمكن ترحيل إعادة تقييم بتاريخ سابق: التشغيل ${entryNo} بتاريخ ${runDate} ما زال قائماً وقد أعاد تقييم الأرصدة نفسها. اعكسه أولاً ثم رحّل التشغيلين بترتيب تواريخهما.`
          : `لا يمكن عكس إعادة التقييم: التشغيل الأحدث ${entryNo} بتاريخ ${runDate} ما زال قائماً وقد بُني على أرصدة هذا التشغيل. اعكس التشغيل الأحدث أولاً ثم أعد المحاولة.`,
      );
    }
    get messageEn(): string {
      return this.action === HeldRunAction.Post
        ? `An earlier-dated revaluation cannot be posted while run ${this.entryNo} dated ${this.runDate} still stands: it already restated the same balances. Reverse it first, then post the runs in date order.`
        : `This revaluation cannot be reversed while the later run ${this.entryNo} dated ${this.runDate} still stands: it was built on this run's balances. Reverse the later run first.`;
    }
  }

  async function laterStandingRun(date: string, currencies: ReadonlySet<string>) {
    return (await deps.ledger.list({ sourceDocTypes: [FX_REVALUATION_DOC_TYPE] })).find(
      (entry) => entry.status === "posted" && !entry.reversesEntryId && !entry.reversedByEntryId && entry.date.slice(0, 10) > date && entry.lines.some((line) => line.currency && currencies.has(line.currency)),
    );
  }

  const laterRunRefusal = (c: Context, err: LaterRevaluationStandsError) => c.json({ error: "FX_REVALUATION_LATER_RUN_STANDS", message: err.message, messageEn: err.messageEn, laterRun: err.entryNo }, 409);

  app.post("/preview", gate("accounting.journal.post"), async (c) => {
    const parsed = fxRevaluationRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const date = await tenantDay(c, parsed.data.date);
    try {
      const { balances, config, derived } = await build(date, parsed.data.currencies);
      const computed = computeFxRevaluation(balances, config);
      return c.json(serializeResult(computed, date, parsed.data.autoReverse ?? true, derived));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/post", gate("accounting.journal.post"), async (c) => {
    const parsed = fxRevaluationRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const autoReverse = parsed.data.autoReverse ?? true;
    const date = await tenantDay(c, parsed.data.date);
    try {
      const { balances, config, derived } = await build(date, parsed.data.currencies, !autoReverse);
      const postingDeps: JournalPostingDeps = {
        ledger: deps.ledger,
        accounts: deps.accounts,
        periods: deps.periods,
        numbering: deps.numbering,
        projects: deps.projects,
        audit: deps.audit,
        events: deps.events,
        now: deps.now,
        actor: getAuthContext(c)?.userId ?? "system",
      };
      const requested = parsed.data.currencies ?? [];
      const result = await deps.ledger.transaction(async () => {
        const later = await laterStandingRun(date, new Set(balances.map((balance) => balance.currency)));
        // INVARIANT: a self-reversing run is gone the next day, so it is harmless under a later standing run only when that day comes before the later run's own.
        if (later && (!autoReverse || nextDay(date) >= later.date.slice(0, 10))) throw new LaterRevaluationStandsError(later.entryNo ?? later.id, later.date.slice(0, 10), HeldRunAction.Post);
        const posted = await postFxRevaluation(balances, config, postingDeps, {
          id: idGen(),
          reversalId: idGen(),
          autoReverse,
        });
        if (posted.entry && posted.computed.shares.length > 0) {
          await deps.saveShares?.(posted.entry.id, posted.computed.shares);
          await deps.releaseSharesRelievedSince?.(date, posted.computed.shares);
        }
        deps.recordRun?.({
          asOfDate: date,
          currencies: requested.length > 0 ? requested : [FX_REVALUATION_ALL_CURRENCIES],
          entryId: posted.entry?.id ?? null,
          ranBy: postingDeps.actor ?? "system",
          ranAt: deps.now ? deps.now() : new Date().toISOString(),
        });
        return posted;
      });
      return c.json(
        {
          preview: serializeResult(result.computed, parsed.data.date, autoReverse, derived),
          entryId: result.entry?.id ?? null,
          entryNo: result.entry?.entryNo ?? null,
          reversalId: result.reversal?.id ?? null,
          reversalNo: result.reversal?.entryNo ?? null,
        },
        201,
      );
    } catch (err) {
      if (err instanceof LaterRevaluationStandsError) return laterRunRefusal(c, err);
      return handleError(c, err);
    }
  });

  const RUN_NOT_FOUND = {
    error: "FX_REVALUATION_RUN_NOT_FOUND",
    message: "تشغيل إعادة تقييم العملات غير موجود.",
    messageEn: "The FX revaluation run does not exist.",
  } as const;

  const serializeResidue = (row: ForeignResidue) => ({ kind: row.kind, ref: row.ref, ...(row.itemType ? { itemType: row.itemType } : {}), currency: row.currency, base: row.base.toString() });

  app.get("/residue", gate("accounting.journal.view"), async (c) => {
    const rows = (await deps.foreignResidues?.()) ?? [];
    return c.json({ rows: rows.map(serializeResidue) });
  });

  app.post("/residue/sweep", gate("accounting.journal.post"), async (c) => {
    const parsed = fxRevaluationRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const date = await tenantDay(c, parsed.data.date);
    const refusalOf = (row: ForeignResidue) => ({
      ...serializeResidue(row),
      message: "الرصيد المتبقي ليس فرق تقريب؛ يُعالج من مصدره ولا يُرحَّل إلى فروق العملة.",
      messageEn: "This residue is not a rounding remainder; it is corrected at its source, not swept to exchange differences.",
    });
    try {
      const actor = getAuthContext(c)?.userId ?? "system";
      const outcome = await deps.ledger.transaction(async () => {
        const residues = (await deps.foreignResidues?.()) ?? [];
        const sweepable = deps.realisedDifferenceAccounts ? residues.filter(isRoundingResidue) : [];
        const refused = residues.filter((row) => !isRoundingResidue(row)).map(refusalOf);
        if (sweepable.length === 0 || !deps.realisedDifferenceAccounts) return { swept: sweepable, refused, entryId: null };
        const accounts = await deps.realisedDifferenceAccounts();
        const zero = Money.zero();
        const lines: JournalLineInput[] = [];
        for (const row of sweepable) {
          if (row.kind === ForeignResidueKind.Item) {
            await deps.releaseItemShare?.({ id: row.ref, type: row.itemType ?? FxOpenItemType.Invoice }, date);
            continue;
          }
          const magnitude = Money.fromScaled(row.base.scaled < 0n ? -row.base.scaled : row.base.scaled);
          const fxRate = (await deps.exchangeRates.findRate(row.currency, date))?.rate ?? "1";
          const overstated = row.base.scaled > 0n;
          lines.push({ accountId: row.ref, debit: overstated ? zero : magnitude, credit: overstated ? magnitude : zero, memo: FX_REVALUATION_LINE_MEMO, currency: row.currency, fxRate });
          lines.push({ accountId: overstated ? accounts.lossAccountId : accounts.gainAccountId, debit: overstated ? magnitude : zero, credit: overstated ? zero : magnitude, memo: FX_REALISED_LINE_MEMO });
        }
        if (lines.length === 0) return { swept: sweepable, refused, entryId: null };
        const posted = await postJournalEntry(
          { id: idGen(), date, memo: `ترحيل فروق تقريب العملات الأجنبية حتى ${date}`, source: "system", sourceDocType: FX_REALISED_DOC_TYPE, lines },
          { ledger: deps.ledger, accounts: deps.accounts, periods: deps.periods, numbering: deps.numbering, projects: deps.projects, audit: deps.audit, vatFilings: deps.vatFilings, events: deps.events, now: deps.now, actor },
        );
        return { swept: sweepable, refused, entryId: posted.id };
      });
      return c.json({ swept: outcome.swept.map(serializeResidue), sweptCount: outcome.swept.length, refused: outcome.refused, entryId: outcome.entryId }, outcome.swept.length > 0 ? 201 : 200);
    } catch (err) {
      return handleError(c, err);
    }
  });

  class RevaluationShareConsumedError extends Error {
    constructor(readonly consumedBy: string) {
      super(`لا يمكن عكس إعادة التقييم: المستند ${consumedBy} أقفل نصيباً منها وما زال قائماً. اعكس هذا المستند أولاً ثم أعد المحاولة.`);
    }
    get messageEn(): string {
      return `This revaluation cannot be reversed: document ${this.consumedBy} has taken part of it and still stands. Reverse that document first.`;
    }
  }

  app.get("/runs", gate("accounting.journal.view"), async (c) => {
    const entries = await deps.ledger.list({ sourceDocTypes: [FX_REVALUATION_DOC_TYPE] });
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const runs = entries
      .filter((entry) => !entry.reversesEntryId)
      .map((entry) => {
        const reversal = entry.reversedByEntryId ? (byId.get(entry.reversedByEntryId) ?? null) : null;
        return {
          entryId: entry.id,
          entryNo: entry.entryNo ?? null,
          date: entry.date,
          memo: entry.memo ?? null,
          status: entry.status,
          reversible: entry.status === "posted",
          reversalEntryId: reversal?.id ?? null,
          reversalEntryNo: reversal?.entryNo ?? null,
          reversalDate: reversal?.date ?? null,
        };
      })
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
    return c.json({ runs });
  });

  app.post("/runs/:entryId/reverse", gate(ReversalPermission.FxRevaluation), requireReversalReason, async (c) => {
    const original = await deps.ledger.findById(c.req.param("entryId"));
    if (!original || original.sourceDocType !== FX_REVALUATION_DOC_TYPE || original.reversesEntryId) return c.json(RUN_NOT_FOUND, 404);
    try {
      const { date, memo } = await readReversalRequest(c);
      const reversalDate = date;
      if (reversalDate < original.date.slice(0, 10)) throw new ReversalDateBeforeOriginalError(original.id, reversalDate, original.date);
      const actor = getAuthContext(c)?.userId ?? "system";
      const result = await deps.ledger.transaction(async () => {
        const later = await laterStandingRun(original.date.slice(0, 10), new Set(original.lines.flatMap((line) => (line.currency ? [line.currency] : []))));
        if (later) throw new LaterRevaluationStandsError(later.entryNo ?? later.id, later.date.slice(0, 10), HeldRunAction.Reverse);
        const consumedBy = await deps.shareConsumer?.(original.id);
        if (consumedBy) throw new RevaluationShareConsumedError(consumedBy);
        const reversed = await reverseJournalEntry(
          original.id,
          { ledger: deps.ledger, accounts: deps.accounts, periods: deps.periods, numbering: deps.numbering, projects: deps.projects, audit: deps.audit, vatFilings: deps.vatFilings, events: deps.events, now: deps.now, actor },
          { reversalId: idGen(), date: reversalDate, memo: memo ?? `عكس إعادة تقييم العملات الأجنبية (${original.entryNo ?? original.id})` },
          { isRevaluationRun: true },
        );
        await recordDocumentReversal(deps.audit, {
          module: "accounting",
          entityType: FX_REVALUATION_DOC_TYPE,
          entityId: original.id,
          actor,
          details: { entryId: original.id, entryNo: original.entryNo ?? null, revaluationDate: original.date, reversalId: reversed.reversal.id, reversalNo: reversed.reversal.entryNo ?? null, date: reversalDate },
        });
        return reversed;
      });
      return c.json({ entryId: original.id, entryStatus: result.original.status, reversalEntryId: result.reversal.id, reversalEntryNo: result.reversal.entryNo ?? null, reversalDate }, 201);
    } catch (err) {
      if (err instanceof LaterRevaluationStandsError) return laterRunRefusal(c, err);
      if (err instanceof RevaluationShareConsumedError) return c.json({ error: "FX_REVALUATION_SHARE_CONSUMED", message: err.message, messageEn: err.messageEn, consumedBy: err.consumedBy }, 409);
      return handleError(c, err);
    }
  });

  return app;
}
