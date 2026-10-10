import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  FX_REVALUATION_ALL_CURRENCIES,
  computeFxRevaluation,
  postFxRevaluation,
  deriveOpenFxBalances,
  nextDay,
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
} from "@mezan/domain";
import { fxRevaluationRequestSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { tenantDay } from "./tenant-day.js";

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
  readonly events?: JournalPostingDeps["events"];
  readonly now?: () => string;
  readonly idGen?: () => string;
  /**
   * Records that a revaluation RAN as of a date, whether or not it posted: when
   * no rate moved there is no entry, and without this the period close could
   * not tell "revalued, nothing to book" from "never revalued".
   */
  readonly recordRun?: (run: FxRevaluationRun) => void;
}

function serializeResult(computed: FxRevaluationResult, date: string, autoReverse: boolean) {
  return {
    date,
    autoReverse,
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

  async function build(date: string, currencyFilter?: readonly string[]): Promise<{ balances: OpenFxBalance[]; config: FxRevaluationConfig }> {
    const lines = (await deps.ledger.listLines?.({ toDate: date })) ?? [];
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
    return { balances, config: { date, closingRates, ...(await deps.differenceAccounts()) } };
  }

  app.post("/preview", gate("accounting.journal.post"), async (c) => {
    const parsed = fxRevaluationRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const date = await tenantDay(c, parsed.data.date);
    try {
      const { balances, config } = await build(date, parsed.data.currencies);
      const computed = computeFxRevaluation(balances, config);
      return c.json(serializeResult(computed, date, parsed.data.autoReverse ?? true));
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
      const { balances, config } = await build(date, parsed.data.currencies);
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
        const posted = await postFxRevaluation(balances, config, postingDeps, {
          id: idGen(),
          reversalId: idGen(),
          autoReverse,
        });
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
          preview: serializeResult(result.computed, parsed.data.date, autoReverse),
          entryId: result.entry?.id ?? null,
          entryNo: result.entry?.entryNo ?? null,
          reversalId: result.reversal?.id ?? null,
          reversalNo: result.reversal?.entryNo ?? null,
        },
        201,
      );
    } catch (err) {
      return handleError(c, err);
    }
  });

  return app;
}
