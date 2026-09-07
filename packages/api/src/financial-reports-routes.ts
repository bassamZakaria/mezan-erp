import { Hono, type Context } from "hono";
import {
  createAccountLedgerReport,
  createBalanceSheetReport,
  createCashFlowReport,
  createGeneralLedgerReport,
  comparativeRange,
  createIncomeStatementReport,
  createTrialBalanceReport,
  createVatReturnReport,
  runReport,
  type Account,
  type AccountRepository,
  type GlReportContext,
  type JournalEntry,
  type LedgerRepository,
  type RunReportOutcome,
  type VatReturnContext,
} from "@mezan/domain";
import { branchScopeOf, createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * القوائم المالية — the seven financial statements (docs/archive/catalog/08-reports.md),
 * mounted under `/financial-reports`. Same shape as ./reports-routes.ts: read
 * the real persisted rows the report needs, hand them to the report engine's
 * `runReport()` as `ctx`, return its outcome verbatim. The data source here is
 * the live posted general ledger (`LedgerRepository`) plus the tenant's chart
 * of accounts — never a fixture. All aggregation/validation lives in
 * `@mezan/domain/reports/*`; this file is wiring only.
 */
export interface FinancialReportsRoutesDeps {
  readonly ledger: Pick<LedgerRepository, "list"> & Pick<Partial<LedgerRepository>, "accountBalances">;
  readonly accounts: Pick<AccountRepository, "list">;
  /**
   * The GL accounts the VAT return reads output/input tax off. Required for
   * `GET /vat-return` unless the caller passes both as query params.
   */
  readonly vatAccounts?: {
    readonly outputVatAccountId: string;
    readonly inputVatAccountId: string;
  };
  /**
   * The tenant's cash/bank GL accounts, used by the balance sheet and cash
   * flow. Omit only when the chart of accounts follows the 11xx-is-cash code
   * convention `classifyAccount()` falls back to.
   */
  readonly cashAccountIds?: readonly string[];
  /** ISO `YYYY-MM-DD` "today" — overridable for tests; defaults to the real date. */
  readonly today?: () => string;
  /**
   * Which branch each posted entry belongs to (P-7).
   *
   * The general ledger carries NO branch dimension of its own — a journal entry
   * has no `branchId` — so a branch-limited statement can only be produced by
   * resolving each entry through the document that posted it. An entry this
   * cannot attribute is EXCLUDED from a branch-limited statement rather than
   * counted in it: a company figure presented as a branch figure is worse than
   * a statement that says it could not be produced.
   *
   * Omitted, the statements accept no branch narrowing at all and say so.
   */
  readonly branchOfEntry?: (entries: readonly JournalEntry[]) => Promise<ReadonlyMap<string, string | null>>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(deps: FinancialReportsRoutesDeps): string {
  return deps.today ? deps.today() : new Date().toISOString().slice(0, 10);
}

function firstOfMonth(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function respond(c: Context, outcome: RunReportOutcome<unknown, unknown>): Response {
  if (!outcome.ok) {
    return c.json({ error: "VALIDATION_ERROR", errors: outcome.errors }, 400);
  }
  return c.json({
    params: outcome.params,
    rows: outcome.rows,
    groups: outcome.groups,
    grandTotals: outcome.grandTotals,
    reconciliation: outcome.reconciliation,
    kpis: outcome.kpis,
  });
}

/** A merged param's value only bounds the ledger query when it is a well-formed date. */
function isoDateOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && ISO_DATE.test(value) ? value : undefined;
}

export function createFinancialReportsRoutes(
  deps: FinancialReportsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  function queryParams(c: Context): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of new URL(c.req.url).searchParams) out[key] = value;
    return out;
  }

  function mergeParams(c: Context, defaults: object): Record<string, unknown> {
    return { ...defaults, ...queryParams(c) };
  }

  /**
   * The posted ledger slice a statement aggregates over. Reversed entries are
   * loaded alongside posted ones: reversal posts a mirror entry and leaves the
   * original in place, so loading only "posted" would keep the mirror and drop
   * what it offsets.
   */
  async function loadJournalEntries(
    bounds: { fromDate?: string; toDate?: string },
    branches?: readonly string[],
  ): Promise<JournalEntry[]> {
    const [posted, reversed] = await Promise.all([
      deps.ledger.list({ ...bounds, status: "posted" }),
      deps.ledger.list({ ...bounds, status: "reversed" }),
    ]);
    const entries = [...posted, ...reversed].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    if (!branches || !deps.branchOfEntry) return entries;
    const allowed = new Set(branches);
    const branchByEntryId = await deps.branchOfEntry(entries);
    return entries.filter((e) => {
      const branchId = branchByEntryId.get(e.id) ?? null;
      return branchId !== null && allowed.has(branchId);
    });
  }

  /**
   * The branches a statement may cover (P-7). `branchScopeOf` is the scope;
   * `?branchId=` may only narrow it, never widen it. `undefined` means the
   * whole company and no per-entry attribution is attempted at all.
   */
  function statementBranches(c: Context): readonly string[] | undefined {
    const scope = branchScopeOf(c);
    const requested = (c.req.query("branchId") ?? "").trim();
    if (requested === "" || requested === "*") return scope;
    if (scope && !scope.includes(requested)) return [];
    return [requested];
  }

  async function loadGlContext(
    c: Context,
    bounds: { fromDate?: string; toDate?: string },
    preloadedAccounts?: readonly Account[],
  ): Promise<GlReportContext> {
    const [accounts, journalEntries] = await Promise.all([
      preloadedAccounts ? Promise.resolve(preloadedAccounts) : deps.accounts.list(),
      loadJournalEntries(bounds, statementBranches(c)),
    ]);
    return { accounts, journalEntries, cashAccountIds: deps.cashAccountIds };
  }

  // --- ميزان المراجعة --------------------------------------------------

  app.get("/trial-balance", gate("accounting.reports.view"), async (c) => {
    const definition = createTrialBalanceReport(todayIso(deps));
    const params = mergeParams(c, definition.defaultParams);
    const toDate = isoDateOrUndefined(params.asOfDate);
    // The trial balance is a balance per account and nothing else, so when the
    // ledger can aggregate it there is no reason to read a line of the GL (Q-6).
    // The SQL aggregate has no branch dimension to narrow by, so a
    // branch-limited trial balance falls back to reading the entries.
    if (deps.ledger.accountBalances && statementBranches(c) === undefined) {
      const [accounts, balances] = await Promise.all([
        deps.accounts.list(),
        deps.ledger.accountBalances({ toDate }),
      ]);
      return respond(c, runReport(definition, params, { accounts, balances }));
    }
    const ctx = await loadGlContext(c, { toDate });
    return respond(c, runReport(definition, params, ctx));
  });

  // --- قائمة الدخل -------------------------------------------------------

  app.get("/income-statement", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createIncomeStatementReport({ periodFrom: firstOfMonth(today), periodTo: today });
    const params = mergeParams(c, definition.defaultParams);
    // The report is comparative, so the ledger query must reach back to the
    // START of the comparison window. Bounding it at periodFrom left the prior
    // column reading zero on every run — the comparison silently did nothing.
    const periodFrom = String(params.periodFrom);
    const prior = comparativeRange({ from: periodFrom, to: String(params.periodTo) }, params.compareTo as never);
    const ctx = await loadGlContext(c, {
      fromDate: isoDateOrUndefined(prior.from < periodFrom ? prior.from : periodFrom),
      toDate: isoDateOrUndefined(params.periodTo),
    });
    return respond(c, runReport(definition, params, ctx));
  });

  // --- الميزانية العمومية -------------------------------------------------

  app.get("/balance-sheet", gate("accounting.reports.view"), async (c) => {
    const definition = createBalanceSheetReport(todayIso(deps));
    const params = mergeParams(c, definition.defaultParams);
    const ctx = await loadGlContext(c, { toDate: isoDateOrUndefined(params.asOfDate) });
    return respond(c, runReport(definition, params, ctx));
  });

  // --- التدفقات النقدية ---------------------------------------------------

  app.get("/cash-flow", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createCashFlowReport({ periodFrom: firstOfMonth(today), periodTo: today });
    const params = mergeParams(c, definition.defaultParams);
    // The opening-cash figure needs every entry before periodFrom, so the
    // ledger query is bounded on the upper end only.
    const ctx = await loadGlContext(c, { toDate: isoDateOrUndefined(params.periodTo) });
    return respond(c, runReport(definition, params, ctx));
  });

  // --- إقرار ضريبة القيمة المضافة ------------------------------------------

  app.get("/vat-return", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createVatReturnReport({ periodFrom: firstOfMonth(today), periodTo: today });
    const params = mergeParams(c, definition.defaultParams);
    const outputVatAccountId =
      typeof params.outputVatAccountId === "string" && params.outputVatAccountId.length > 0
        ? params.outputVatAccountId
        : deps.vatAccounts?.outputVatAccountId;
    const inputVatAccountId =
      typeof params.inputVatAccountId === "string" && params.inputVatAccountId.length > 0
        ? params.inputVatAccountId
        : deps.vatAccounts?.inputVatAccountId;
    if (!outputVatAccountId || !inputVatAccountId) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          errors: [
            {
              field: outputVatAccountId ? "inputVatAccountId" : "outputVatAccountId",
              message: "حدد حسابي ضريبة المخرجات والمدخلات",
            },
          ],
        },
        400,
      );
    }
    const base = await loadGlContext(c, {
      fromDate: isoDateOrUndefined(params.periodFrom),
      toDate: isoDateOrUndefined(params.periodTo),
    });
    const ctx: VatReturnContext = { ...base, outputVatAccountId, inputVatAccountId };
    return respond(c, runReport(definition, params, ctx));
  });

  // --- دفتر الأستاذ العام --------------------------------------------------

  app.get("/general-ledger", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createGeneralLedgerReport({ periodFrom: firstOfMonth(today), periodTo: today });
    const params = mergeParams(c, definition.defaultParams);
    const ctx = await loadGlContext(c, {
      fromDate: isoDateOrUndefined(params.periodFrom),
      toDate: isoDateOrUndefined(params.periodTo),
    });
    return respond(c, runReport(definition, params, ctx));
  });

  // --- دفتر حساب -----------------------------------------------------------

  app.get("/account-ledger", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const accounts = await deps.accounts.list();
    const postable = accounts.filter((a) => !a.isHeader);
    const definition = createAccountLedgerReport(postable, {
      accountId: postable[0]?.id ?? "",
      periodFrom: firstOfMonth(today),
      periodTo: today,
    });
    const params = mergeParams(c, definition.defaultParams);
    // The opening balance needs every entry before periodFrom.
    const ctx = await loadGlContext(c, { toDate: isoDateOrUndefined(params.periodTo) }, accounts);
    return respond(c, runReport(definition, params, ctx));
  });

  return app;
}
