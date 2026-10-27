import { Hono, type Context } from "hono";
import {
  COST_OF_SALES_ROUTING_KEYS,
  COCKPIT_MARGIN_WEEKS,
  COCKPIT_SPARK_DAYS,
  Money,
  Qty,
  can,
  cockpitAddDays,
  cockpitDailyFlows,
  cockpitLineInView,
  cockpitLowStock,
  cockpitMarginPercent,
  cockpitSumFlows,
  cockpitTopMovers,
  cockpitUnattributedLine,
  convertToBase,
  customerOverdueBalances,
  routedAccountId,
  salesInvoiceBaseGrandTotal,
  salesInvoiceTotals,
  salesReturnCreditByInvoice,
  salesReturnLineBase,
  toTenantDay,
  UNATTRIBUTED_BRANCH_ID,
  withinBranchScope,
  type Account,
  type AgingCustomersContext,
  type AuthContext,
  type AccountRoutingRepository,
  type Cheque,
  type CockpitAccountSets,
  type CockpitBranchView,
  type CockpitDayFlow,
  type CockpitLedgerLine,
  type CockpitSaleLine,
  type Item,
  type LedgerRepository,
  type SalesInvoice,
  type SalesInvoiceRepository,
  type SalesReturnDocument,
  type TreasuryAccount,
  type WacSnapshot,
} from "@mezan/domain";
import {
  cockpitQuerySchema,
  type CockpitCashDTO,
  type CockpitDTO,
  type CockpitDayDTO,
  type CockpitDirectionDTO,
  type CockpitLowStockDTO,
  type CockpitMarginWeekDTO,
  type CockpitMoverDTO,
  type CockpitOverdueDTO,
  type CockpitTreasuryDTO,
  type CockpitVersionDTO,
} from "@mezan/contracts";
import {
  branchScopeOf,
  createAuthenticatedGate,
  createPermissionGate,
  getAuthContext,
  warehouseScopeOf,
  withinScope,
  type AuthContextResolver,
} from "./permission-gate.js";
import { tenantToday } from "./tenant-day.js";
import { VIEW_UNATTRIBUTED_PERMISSION, type BranchLineView } from "./branch-view.js";

export const COCKPIT_PERMISSION = "accounting.cockpit.view";

const CUSTOMER_RECEIVABLE_CODES = new Set(["1105", "1110", "1360"]);
const REVENUE_SLOTS = ["item_type.revenue", "item_type.service_revenue", "contracting.revenue", "sales_discount.contra"];
const COGS_SLOTS = COST_OF_SALES_ROUTING_KEYS;
const SOLD_STATUSES = ["confirmed", "partially_paid", "paid"] as const satisfies readonly SalesInvoice["status"][];

export interface CockpitSalesReturns {
  list(filter?: { readonly status?: "confirmed" }): Promise<readonly SalesReturnDocument[]>;
  listByLineRef?(field: string, ids: readonly string[], filter?: { readonly status?: "confirmed" }): Promise<readonly SalesReturnDocument[]>;
}

/**
 * The AR sub-ledger's netting terms for a line view as of a day — the ones the
 * customer aging ladder folds (reports-routes `customerAgingSetIn`), so the
 * overdue figure ties to the receivables control account like the ladder does.
 */
export type CockpitReceivablesLedger = (view: BranchLineView, asOfDate: string) => Promise<AgingCustomersContext>;

export interface CockpitRoutesDeps {
  readonly ledger: Pick<LedgerRepository, "listLines" | "accountBalance">;
  readonly accounts: { list(): Promise<readonly Account[]> };
  readonly accountRouting: Pick<AccountRoutingRepository, "get">;
  readonly items: { list(): Promise<readonly Item[]> };
  readonly salesInvoices: Pick<SalesInvoiceRepository, "list">;
  readonly salesReturns: CockpitSalesReturns;
  readonly receivables: CockpitReceivablesLedger;
  readonly treasuryAccounts: { list(): Promise<readonly TreasuryAccount[]> };
  readonly cheques: { list(): Promise<readonly Cheque[]> };
  readonly wacSnapshots: { list(): Promise<readonly WacSnapshot[]> };
  readonly warehouses: { findAll(): Promise<readonly { readonly id: string; readonly branchId: string }[]> };
  readonly bookVersion: () => string | Promise<string>;
  readonly today?: () => string;
  readonly now?: () => string;
}

export interface CockpitCaller {
  readonly auth: AuthContext;
  readonly branchScope: readonly string[] | undefined;
  readonly warehouseScope: readonly string[] | undefined;
}

function mayRead(caller: CockpitCaller, permission: string): boolean {
  return can(caller.auth, permission);
}

function callerOf(c: Context): CockpitCaller | null {
  const auth = getAuthContext(c);
  return auth ? { auth, branchScope: branchScopeOf(c), warehouseScope: warehouseScopeOf(c) } : null;
}

async function accountSets(deps: CockpitRoutesDeps, items: readonly Item[], cheques: readonly Cheque[], treasury: readonly TreasuryAccount[]): Promise<CockpitAccountSets> {
  const [accounts, routing] = await Promise.all([deps.accounts.list(), deps.accountRouting.get()]);
  const leafIds = new Set(accounts.filter((a) => !a.isHeader).map((a) => a.id));
  const routed = (slots: readonly string[]) => slots.map((slot) => routedAccountId(routing, slot)).filter((id): id is string => id !== null);
  const revenue = new Set([...routed(REVENUE_SLOTS), ...items.map((i) => i.revenueAccountId).filter((id): id is string => !!id)]);
  const cogs = new Set([...routed(COGS_SLOTS), ...items.map((i) => i.cogsAccountId).filter((id): id is string => !!id)]);
  const underCollection = new Set(cheques.map((cheque) => cheque.controlAccounts.underCollectionAccountId));
  const incoming = new Set(cheques.filter((cheque) => cheque.direction === "incoming").map((cheque) => cheque.controlAccounts.underCollectionAccountId));
  const treasuryIds = new Set(
    treasury.map((t) => t.glAccountId).filter((id): id is string => !!id && !underCollection.has(id)),
  );
  const receivable = routedAccountId(routing, "control.receivable");
  const customerSide = new Set([
    ...accounts.filter((a) => CUSTOMER_RECEIVABLE_CODES.has(a.code)).map((a) => a.id),
    ...(receivable ? [receivable] : []),
    ...incoming,
  ]);
  const keep = (ids: Set<string>) => new Set([...ids].filter((id) => leafIds.has(id)));
  return { revenue: keep(revenue), cogs: keep(cogs), treasury: keep(treasuryIds), customerSide: keep(customerSide) };
}

function viewOf(caller: CockpitCaller, requested: string): CockpitBranchView & { readonly narrowed: boolean; readonly empty: boolean } {
  const scope = caller.branchScope;
  const outOfScope = requested !== "" && requested !== UNATTRIBUTED_BRANCH_ID && scope !== undefined && !scope.includes(requested);
  return { branchId: requested, scope, narrowed: scope !== undefined || requested !== "", empty: outOfScope };
}

function dayDTO(flow: CockpitDayFlow, withCost: boolean): CockpitDayDTO {
  return {
    date: flow.date,
    sales: Money.fromScaled(flow.sales).toString(),
    collections: Money.fromScaled(flow.collections).toString(),
    cogs: withCost ? Money.fromScaled(flow.cogs).toString() : null,
    grossProfit: withCost ? Money.fromScaled(flow.sales - flow.cogs).toString() : null,
    grossMarginPercent: withCost ? cockpitMarginPercent(flow.sales, flow.cogs) : null,
  };
}

async function cashByTreasury(
  deps: CockpitRoutesDeps,
  caller: CockpitCaller,
  view: CockpitBranchView & { readonly narrowed: boolean },
  treasury: readonly TreasuryAccount[],
  cheques: readonly Cheque[],
  today: string,
): Promise<CockpitCashDTO> {
  const underCollection = new Set(cheques.map((cheque) => cheque.controlAccounts.underCollectionAccountId));
  // Two branches may hold treasury accounts pointing at ONE GL account, and
  // that account's balance is then a company-wide figure. Answering it under a
  // branch filter is the defect: it is not that branch's cash.
  const branchesPerGl = new Map<string, Set<string>>();
  for (const account of treasury) {
    if (!account.glAccountId) continue;
    const branches = branchesPerGl.get(account.glAccountId) ?? new Set<string>();
    if (account.branchId) branches.add(account.branchId);
    branchesPerGl.set(account.glAccountId, branches);
  }
  const scoped = withinScope(treasury, caller.branchScope, (t) => t.branchId).filter(
    (t) => view.branchId === "" || t.branchId === view.branchId,
  );
  const seen = new Set<string>(underCollection);
  const rows: CockpitTreasuryDTO[] = [];
  let total = 0n;
  const branchAttributed = async (glAccountId: string): Promise<Money> => {
    const lines = (await deps.ledger.listLines?.({ accountIds: [glAccountId], toDate: today })) ?? [];
    return Money.fromScaled(
      lines
        .filter((line) => cockpitLineInView(line.branchId, view))
        .reduce((sum, line) => sum + line.debit.scaled - line.credit.scaled, 0n),
    );
  };
  for (const account of [...scoped].sort((a, b) => a.code.localeCompare(b.code))) {
    let balance: string | null = null;
    const gl = account.glAccountId;
    const shared = gl !== null && (branchesPerGl.get(gl)?.size ?? 0) > 1;
    if (gl && !seen.has(gl)) {
      seen.add(gl);
      const held = view.narrowed && (shared || account.branchId === null) ? await branchAttributed(gl) : (await deps.ledger.accountBalance(gl, today)).balance;
      total += held.scaled;
      balance = held.toString();
    }
    if (account.status !== "active" && balance === null) continue;
    rows.push({
      treasuryAccountId: account.id,
      code: account.code,
      name: account.name,
      nameEn: account.nameEn,
      type: account.type,
      branchId: account.branchId,
      glAccountId: gl,
      balance,
      sharedAcrossBranches: shared,
    });
  }
  return { total: Money.fromScaled(total).toString(), accounts: rows };
}

async function overdueSection(deps: CockpitRoutesDeps, caller: CockpitCaller, view: CockpitBranchView, today: string): Promise<CockpitOverdueDTO> {
  const lineView: BranchLineView = {
    scope: caller.branchScope,
    includeUnattributed: caller.branchScope === undefined || can(caller.auth, VIEW_UNATTRIBUTED_PERMISSION),
  };
  const ledger = await deps.receivables(lineView, today);
  let amount = 0n;
  let credit = 0n;
  let invoiceCount = 0;
  let customerCount = 0;
  let oldest: string | null = null;
  for (const balance of customerOverdueBalances({ asOfDate: today, branchId: view.branchId }, ledger).values()) {
    credit += balance.unallocatedCredit.scaled;
    if (balance.overdueCount === 0) continue;
    amount += balance.overdue.scaled;
    invoiceCount += balance.overdueCount;
    customerCount += 1;
    if (balance.oldestOverdueDate !== null && (oldest === null || balance.oldestOverdueDate < oldest)) oldest = balance.oldestOverdueDate;
  }
  return {
    amount: Money.fromScaled(amount).toString(),
    invoiceCount,
    customerCount,
    oldestDueDate: oldest,
    unallocatedCredits: Money.fromScaled(credit).toString(),
  };
}

async function lowStockSection(deps: CockpitRoutesDeps, caller: CockpitCaller, items: readonly Item[], view: CockpitBranchView): Promise<CockpitLowStockDTO> {
  const [snapshots, warehouses] = await Promise.all([deps.wacSnapshots.list(), deps.warehouses.findAll()]);
  const branchOf = new Map(warehouses.map((w) => [w.id, w.branchId]));
  const warehouseScope = caller.warehouseScope;
  const onHand = new Map<string, Qty>();
  for (const position of snapshots) {
    const branch = branchOf.get(position.warehouseId) ?? null;
    if (!withinBranchScope(branch, view.scope)) continue;
    if (view.branchId !== "" && branch !== view.branchId) continue;
    if (warehouseScope && !warehouseScope.includes(position.warehouseId)) continue;
    onHand.set(position.itemId, (onHand.get(position.itemId) ?? Qty.zero()).add(position.onHand));
  }
  const summary = cockpitLowStock(items, onHand);
  return {
    low: summary.low,
    out: summary.out,
    firstItemNameAr: summary.first?.nameAr ?? null,
    firstItemNameEn: summary.first?.nameEn ?? null,
  };
}

async function moversSection(
  deps: CockpitRoutesDeps,
  caller: CockpitCaller,
  view: CockpitBranchView,
  items: readonly Item[],
  today: string,
): Promise<CockpitMoverDTO[]> {
  const currentFrom = cockpitAddDays(today, -(COCKPIT_SPARK_DAYS - 1));
  const previousFrom = cockpitAddDays(today, -(COCKPIT_SPARK_DAYS * 2 - 1));
  const previousTo = cockpitAddDays(today, -COCKPIT_SPARK_DAYS);
  const invoices = (
    await deps.salesInvoices.list({
      statusIn: [...SOLD_STATUSES],
      fromDate: previousFrom,
      toDate: today,
      branchScope: caller.branchScope,
      warehouseScope: caller.warehouseScope,
    })
  ).filter((invoice) => view.branchId === "" || invoice.branchId === view.branchId);
  const lines: CockpitSaleLine[] = [];
  for (const invoice of invoices) {
    const totals = salesInvoiceTotals(invoice);
    invoice.lines.forEach((line, index) => {
      const lineTotals = totals.lines[index];
      if (!lineTotals) return;
      const base = invoice.fxRate ? convertToBase(lineTotals.taxableBase, invoice.fxRate) : lineTotals.taxableBase;
      lines.push({ itemId: line.itemId, date: invoice.date, amount: base.scaled });
    });
  }

  // A sold-then-returned item moved nothing. Netting the return at the date it
  // happened is what keeps it out of the movers list, and what puts a genuine
  // wave of returns into it as a faller.
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const returns = invoiceIds.length === 0
    ? []
    : deps.salesReturns.listByLineRef
      ? await deps.salesReturns.listByLineRef("sourceInvoiceId", invoiceIds, { status: "confirmed" })
      : await deps.salesReturns.list({ status: "confirmed" });
  const soldInvoice = new Set(invoiceIds);
  for (const doc of returns) {
    if (doc.status !== "confirmed") continue;
    if (doc.date < previousFrom || doc.date > today) continue;
    for (const line of doc.lines) {
      if (!soldInvoice.has(line.sourceInvoiceId)) continue;
      lines.push({ itemId: line.itemId, date: doc.date, amount: -salesReturnLineBase(line).revenue.scaled });
    }
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  return cockpitTopMovers(lines, { from: currentFrom, to: today }, { from: previousFrom, to: previousTo }).map((mover) => {
    const item = byId.get(mover.itemId);
    return {
      itemId: mover.itemId,
      code: item?.code ?? null,
      nameAr: item?.nameAr ?? null,
      nameEn: item?.nameEn ?? null,
      current: mover.current.toString(),
      previous: mover.previous.toString(),
      change: mover.change.toString(),
      direction: mover.direction as unknown as CockpitDirectionDTO,
    };
  });
}

export async function composeCockpit(deps: CockpitRoutesDeps, caller: CockpitCaller, branchId: string, today: string, now: string): Promise<CockpitDTO> {
  const bookVersion = await deps.bookVersion();
  const compareDate = cockpitAddDays(today, -COCKPIT_SPARK_DAYS);
  const sparkFrom = cockpitAddDays(today, -(COCKPIT_SPARK_DAYS - 1));
  const trendFrom = cockpitAddDays(today, -(COCKPIT_SPARK_DAYS * COCKPIT_MARGIN_WEEKS - 1));
  const view = viewOf(caller, branchId);

  const withCost = mayRead(caller, "sales.invoice.view_cost");
  const withSales = mayRead(caller, "sales.invoice.view");
  const withCash = mayRead(caller, "treasury.account.view");
  const withStock = mayRead(caller, "inventory.item.view");

  const [items, cheques, treasury] = await Promise.all([deps.items.list(), deps.cheques.list(), deps.treasuryAccounts.list()]);
  const sets = await accountSets(deps, items, cheques, treasury);
  const accountIds = [...new Set([...sets.revenue, ...sets.cogs, ...sets.treasury, ...sets.customerSide])];
  const lines: readonly CockpitLedgerLine[] =
    view.empty || accountIds.length === 0 ? [] : ((await deps.ledger.listLines?.({ fromDate: trendFrom, toDate: today, accountIds })) ?? []);

  const flows = cockpitDailyFlows(lines, sets, trendFrom, today, (line) => cockpitLineInView(line.branchId, view));
  const unattributedFlows = cockpitDailyFlows(lines, sets, compareDate, today, (line) => cockpitUnattributedLine(line.branchId, view));
  const todayFlow = flows.get(today)!;
  const compareFlow = flows.get(compareDate)!;
  const sparkDays = [...flows.values()].filter((flow) => flow.date >= sparkFrom);
  const unattributed7d = cockpitSumFlows([...unattributedFlows.values()].filter((flow) => flow.date >= sparkFrom));

  const marginTrend: CockpitMarginWeekDTO[] = [];
  for (let week = COCKPIT_MARGIN_WEEKS - 1; week >= 0; week -= 1) {
    const to = cockpitAddDays(today, -week * COCKPIT_SPARK_DAYS);
    const from = cockpitAddDays(to, -(COCKPIT_SPARK_DAYS - 1));
    const sum = cockpitSumFlows([...flows.values()].filter((flow) => flow.date >= from && flow.date <= to));
    marginTrend.push({
      from,
      to,
      revenue: Money.fromScaled(sum.sales).toString(),
      cogs: Money.fromScaled(sum.cogs).toString(),
      grossProfit: Money.fromScaled(sum.sales - sum.cogs).toString(),
      grossMarginPercent: cockpitMarginPercent(sum.sales, sum.cogs),
    });
  }

  const [cash, overdue, lowStock, movers] = await Promise.all([
    withCash ? cashByTreasury(deps, caller, view, view.empty ? [] : treasury, cheques, today) : Promise.resolve(null),
    withSales && !view.empty && view.branchId !== UNATTRIBUTED_BRANCH_ID ? overdueSection(deps, caller, view, today) : Promise.resolve(null),
    withStock && !view.empty && view.branchId !== UNATTRIBUTED_BRANCH_ID ? lowStockSection(deps, caller, items, view) : Promise.resolve(null),
    withSales && !view.empty && view.branchId !== UNATTRIBUTED_BRANCH_ID ? moversSection(deps, caller, view, items, today) : Promise.resolve(null),
  ]);

  const money = (scaled: bigint) => Money.fromScaled(scaled).toString();
  const body: CockpitDTO = {
    generatedAt: now,
    today,
    compareDate,
    windowFrom: sparkFrom,
    bookVersion,
    branchId: view.branchId,
    branchNarrowed: view.narrowed,
    pulse: {
      sales: { today: money(todayFlow.sales), sameWeekdayLastWeek: money(compareFlow.sales) },
      collections: { today: money(todayFlow.collections), sameWeekdayLastWeek: money(compareFlow.collections) },
      grossProfit: withCost
        ? { today: money(todayFlow.sales - todayFlow.cogs), sameWeekdayLastWeek: money(compareFlow.sales - compareFlow.cogs) }
        : null,
      grossMarginPercent: withCost
        ? {
            today: cockpitMarginPercent(todayFlow.sales, todayFlow.cogs),
            sameWeekdayLastWeek: cockpitMarginPercent(compareFlow.sales, compareFlow.cogs),
          }
        : null,
    },
    days: sparkDays.map((flow) => dayDTO(flow, withCost)),
    marginTrend: withCost ? marginTrend : null,
    topMovers: movers,
    cash,
    overdueReceivables: overdue,
    lowStock,
    unattributed: {
      salesToday: money(unattributedFlows.get(today)?.sales ?? 0n),
      sales7d: money(unattributed7d.sales),
      collections7d: money(unattributed7d.collections),
    },
  };
  return body;
}

export function createCockpitRoutes(deps: CockpitRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const todayOf = (c: Context) => tenantToday(c, deps.today);
  const nowOf = () => (deps.now ? deps.now() : new Date().toISOString());

  /**
   * The books' opaque change counter, polled by every dashboard so its panels
   * refresh when something is posted.
   *
   * Gated on the SESSION, not on `accounting.cockpit.view`: it carries no
   * business figure, and gating it on the cockpit's permission left everyone
   * else's dashboard frozen until they reloaded the page by hand.
   */
  app.get("/version", createAuthenticatedGate(resolveAuthContext), async (c) => {
    const body: CockpitVersionDTO = { bookVersion: await deps.bookVersion() };
    return c.json(body);
  });

  app.get("/cockpit", gate(COCKPIT_PERMISSION), async (c) => {
    const parsed = cockpitQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "INVALID_QUERY", message: "معايير لوحة المالك غير صالحة.", messageEn: "Invalid cockpit parameters.", issues: parsed.error.issues }, 400);
    }
    const caller = callerOf(c);
    if (!caller) return c.json({ error: "FORBIDDEN" }, 403);
    return c.json(await composeCockpit(deps, caller, parsed.data.branchId, await todayOf(c), nowOf()));
  });

  return app;
}
