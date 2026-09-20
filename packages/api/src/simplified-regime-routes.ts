import { Hono, type Context } from "hono";
import {
  Money,
  DECREE_420_BOOKS,
  NO_SIMPLIFIED_REGIME,
  SALES_INVOICE_ACTIVE_STATUSES,
  computeClientConcentration,
  computeSimplifiedRegimeLiability,
  createSimplifiedRegimeComparisonReport,
  recordSimplifiedRegime,
  runReport,
  salesInvoiceTotals,
  salesInvoiceBaseTotals,
  simplifiedRegimeActiveOn,
  simplifiedRegimeFlags,
  simplifiedRegimeScheduleOn,
  turnoverForWindow,
  vatPeriodModeFor,
  vatPeriodWindows,
  InvalidSimplifiedRegimeRecordError,
  type AccountRepository,
  type ClientTurnover,
  type CustomerRepository,
  type LedgerRepository,
  type RunReportOutcome,
  type SalesInvoiceRepository,
  type SimplifiedRegimeElection,
  type SimplifiedRegimeRepository,
  type SimplifiedRegimeSchedule,
} from "@mezan/domain";
import { recordSimplifiedRegimeSchema } from "@mezan/contracts";
import { branchScopeOf, createPermissionGate, withinScope, type AuthContextResolver } from "./permission-gate.js";
import { tenantDay } from "./tenant-day.js";

/**
 * النظام الضريبي المبسط (قانون 6 لسنة 2025) — `/tax/simplified-regime`.
 *
 * THE ROUTES DO NOT ELECT ANYTHING. `PUT /` records what the taxpayer already
 * filed with the ETA on Form 1/10 (or withdrew on Form 1/11). The election is
 * irrevocable for five years, so there is deliberately no verb here that could
 * be read as making one, and the payload carries the form reference precisely
 * so the record is a claim about a filing rather than a switch someone flipped.
 *
 * `GET /` answers with the record, the statutory table in force, the ESTIMATED
 * liability over the requested window and the client-concentration reading.
 * The liability is marked `estimate: true` on the wire: Mezan computes a
 * figure for an owner to take to their accountant; the ETA assesses.
 */

export interface SimplifiedRegimeRoutesDeps {
  readonly regime: SimplifiedRegimeRepository;
  readonly salesInvoices: SalesInvoiceRepository;
  readonly customers: CustomerRepository;
  readonly accounts: AccountRepository;
  readonly ledger: LedgerRepository;
  readonly now?: () => string;
  /** Overridable so a test can pin the table without pinning the clock. */
  readonly scheduleOn?: (day: string) => SimplifiedRegimeSchedule | null;
}

/** The tenant's calendar day, never the host's UTC one (D288). */
async function todayIso(c: Context, deps: SimplifiedRegimeRoutesDeps): Promise<string> {
  return tenantDay(c, deps.now?.() ?? new Date().toISOString());
}

/** The window the estimate is computed over — the calendar year `periodTo` falls in by default. */
function windowOf(c: Context, today: string): { periodFrom: string; periodTo: string } {
  const search = new URL(c.req.url).searchParams;
  const periodTo = search.get("periodTo") ?? today;
  const periodFrom = search.get("periodFrom") ?? `${periodTo.slice(0, 4)}-01-01`;
  return { periodFrom, periodTo };
}

function respond(c: Context, outcome: RunReportOutcome<unknown, unknown>): Response {
  if (!outcome.ok) return c.json({ error: "VALIDATION_ERROR", errors: outcome.errors }, 400);
  return c.json({
    params: outcome.params,
    rows: outcome.rows,
    groups: outcome.groups,
    grandTotals: outcome.grandTotals,
    reconciliation: outcome.reconciliation,
    kpis: outcome.kpis,
  });
}

export function createSimplifiedRegimeRoutes(
  deps: SimplifiedRegimeRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const scheduleOn = deps.scheduleOn ?? simplifiedRegimeScheduleOn;

  async function scopedInvoices(c: Context) {
    return withinScope(await deps.salesInvoices.list(), branchScopeOf(c), (invoice) => invoice.branchId);
  }

  /**
   * Turnover per customer over the window, for the ≥90% concentration test.
   *
   * It reads the SAME invoices and the SAME `salesInvoiceTotals` the sales
   * report does, so the shares always add up to the turnover the liability was
   * computed on — two aggregations would be two different years.
   */
  async function concentrationInput(
    c: Context,
    window: { periodFrom: string; periodTo: string },
  ): Promise<readonly ClientTurnover[]> {
    const [invoices, customers] = await Promise.all([scopedInvoices(c), deps.customers.findAll()]);
    const names = new Map(customers.map((customer) => [customer.id, customer.nameAr]));
    const byCustomer = new Map<string, bigint>();
    for (const invoice of invoices) {
      if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
      const day = invoice.date.slice(0, 10);
      if (day < window.periodFrom || day > window.periodTo) continue;
      const net = salesInvoiceBaseTotals(salesInvoiceTotals(invoice), invoice.fxRate).taxableTotal.scaled;
      byCustomer.set(invoice.customerId, (byCustomer.get(invoice.customerId) ?? 0n) + net);
    }
    return [...byCustomer].map(([customerId, scaled]) => ({
      customerId,
      customerName: names.get(customerId) ?? customerId,
      turnover: Money.fromScaled(scaled),
    }));
  }

  app.get("/", gate("admin.settings.view"), async (c) => {
    const today = await todayIso(c, deps);
    const window = windowOf(c, today);
    const election: SimplifiedRegimeElection = (await deps.regime.get()) ?? NO_SIMPLIFIED_REGIME;
    const schedule = scheduleOn(window.periodTo) ?? scheduleOn(today);

    const turnover = schedule === null ? null : turnoverForWindow({ invoices: await scopedInvoices(c) }, window);
    const liability = schedule === null || turnover === null ? null : computeSimplifiedRegimeLiability(schedule, turnover);
    const concentration =
      schedule === null ? null : computeClientConcentration(schedule, await concentrationInput(c, window));

    const mode = vatPeriodModeFor(election, schedule, window.periodTo);
    const year = Number(window.periodTo.slice(0, 4));

    return c.json({
      election,
      flags: simplifiedRegimeFlags(election, schedule),
      schedule,
      periodFrom: window.periodFrom,
      periodTo: window.periodTo,
      liability:
        liability === null
          ? null
          : {
              turnover: liability.turnover,
              standing: liability.standing,
              ratePercent: liability.ratePercent,
              tax: liability.tax,
              sources: liability.sources,
              estimate: liability.estimate,
            },
      concentration,
      vatPeriod: {
        mode,
        windows: vatPeriodWindows(Number.isFinite(year) ? year : new Date().getUTCFullYear(), mode, schedule),
        source: mode === "quarterly" ? (schedule?.vatFiling.source ?? null) : null,
      },
      books: DECREE_420_BOOKS,
      /** Whether postings dated today fall inside the regime — what the VAT mode turns on. */
      activeToday: simplifiedRegimeActiveOn(election, today),
    });
  });

  app.put("/", gate("admin.settings.edit"), async (c) => {
    const parsed = recordSimplifiedRegimeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      // The schema's refinements carry the Arabic reason (the Form 1/10 or 1/11
      // date and number); zod's own messages are English and stay in `details`.
      const reason = parsed.error.issues.find((issue) => issue.code === "custom")?.message;
      return c.json(
        { error: "VALIDATION_ERROR", ...(reason ? { message: reason } : {}), details: parsed.error.flatten() },
        400,
      );
    }
    const ctx = await resolveAuthContext(c);
    try {
      const election = recordSimplifiedRegime(
        {
          state: parsed.data.state,
          electedOn: parsed.data.electedOn ?? null,
          form110Reference: parsed.data.form110Reference ?? null,
          withdrawnOn: parsed.data.withdrawnOn ?? null,
          form111Reference: parsed.data.form111Reference ?? null,
          eInvoicingJoinedOn: parsed.data.eInvoicingJoinedOn ?? null,
          notes: parsed.data.notes ?? null,
          recordedBy: ctx.userId ?? "system",
          recordedAt: deps.now?.(),
        },
        scheduleOn(parsed.data.electedOn ?? await todayIso(c, deps)),
      );
      await deps.regime.save(election);
      return c.json(election);
    } catch (err) {
      if (err instanceof InvalidSimplifiedRegimeRecordError) {
        return c.json({ error: err.code, field: err.field, message: err.message }, 400);
      }
      throw err;
    }
  });

  app.get("/comparison", gate("admin.settings.view"), async (c) => {
    const today = await todayIso(c, deps);
    const window = windowOf(c, today);
    const definition = createSimplifiedRegimeComparisonReport(window.periodFrom, window.periodTo, scheduleOn);
    const params: Record<string, string> = {};
    for (const [key, value] of new URL(c.req.url).searchParams) params[key] = value;
    const [invoices, accounts, journalEntries] = await Promise.all([
      scopedInvoices(c),
      deps.accounts.list(),
      deps.ledger.list(),
    ]);
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...params }, { invoices, accounts, journalEntries }),
    );
  });

  return app;
}
