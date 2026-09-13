import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  computeFxRevaluation,
  postFxRevaluation,
  deriveOpenFxBalances,
  nextDay,
  FxRateMissingError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  type AccountRepository,
  type ExchangeRateRepository,
  type FxRevaluationConfig,
  type FxRevaluationResult,
  type JournalPostingDeps,
  type LedgerRepository,
  type OpenFxBalance,
} from "@mezan/domain";
import { fxRevaluationRequestSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

export interface FxRevaluationRoutesDeps {
  readonly ledger: LedgerRepository;
  readonly accounts: AccountRepository;
  readonly periods: JournalPostingDeps["periods"];
  readonly numbering: JournalPostingDeps["numbering"];
  readonly projects?: JournalPostingDeps["projects"];
  readonly exchangeRates: ExchangeRateRepository;
  /** فروق عملة دائنة — FX gain account. */
  readonly gainAccountId: string;
  /** فروق عملة مدينة — FX loss account. */
  readonly lossAccountId: string;
  readonly audit?: JournalPostingDeps["audit"];
  readonly events?: JournalPostingDeps["events"];
  readonly now?: () => string;
  readonly idGen?: () => string;
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
    return { balances, config: { date, closingRates, gainAccountId: deps.gainAccountId, lossAccountId: deps.lossAccountId } };
  }

  app.post("/preview", gate("accounting.journal.post"), async (c) => {
    const parsed = fxRevaluationRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const { balances, config } = await build(parsed.data.date, parsed.data.currencies);
      const computed = computeFxRevaluation(balances, config);
      return c.json(serializeResult(computed, parsed.data.date, parsed.data.autoReverse ?? true));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/post", gate("accounting.journal.post"), async (c) => {
    const parsed = fxRevaluationRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const autoReverse = parsed.data.autoReverse ?? true;
    try {
      const { balances, config } = await build(parsed.data.date, parsed.data.currencies);
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
      const result = await postFxRevaluation(balances, config, postingDeps, {
        id: idGen(),
        reversalId: idGen(),
        autoReverse,
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
