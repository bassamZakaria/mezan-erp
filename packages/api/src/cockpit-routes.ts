import { Hono, type Context } from "hono";
import {
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
  cockpitOverdue,
  cockpitSumFlows,
  cockpitTopMovers,
  cockpitUnattributedLine,
  convertToBase,
  routedAccountId,
  salesInvoiceBaseGrandTotal,
  salesInvoiceTotals,
  salesReturnCreditByInvoice,
  toTenantDay,
  UNATTRIBUTED_BRANCH_ID,
  withinBranchScope,
  type Account,
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
import { branchScopeOf, createPermissionGate, getAuthContext, warehouseScopeOf, withinScope, type AuthContextResolver } from "./permission-gate.js";
import { tenantToday } from "./tenant-day.js";

export const COCKPIT_PERMISSION = "accounting.cockpit.view";

const CUSTOMER_RECEIVABLE_CODES = new Set(["1105", "1110", "1360"]);
const REVENUE_SLOTS = ["item_type.revenue", "item_type.service_revenue", "contracting.revenue", "sales_discount.contra"];
const COGS_SLOTS = ["item_type.cogs", "contracting.cost_of_revenue"];
const OPEN_STATUSES = ["confirmed", "partially_paid"] as const satisfies readonly SalesInvoice["status"][];
const SOLD_STATUSES = ["confirmed", "partially_paid", "paid"] as const satisfies readonly SalesInvoice["status"][];

export interface CockpitSalesReturns {
  list(filter?: { readonly status?: "confirmed" }): Promise<readonly SalesReturnDocument[]>;
  listByLineRef?(field: string, ids: readonly string[], filter?: { readonly status?: "confirmed" }): Promise<readonly SalesReturnDocument[]>;
}

export interface CockpitRoutesDeps {
  readonly ledger: Pick<LedgerRepository, "listLines" | "accountBalance">;
  readonly accounts: { list(): Promise<readonly Account[]> };
  readonly accountRouting: Pick<AccountRoutingRepository, "get">;
  readonly items: { list(): Promise<readonly Item[]> };
  readonly salesInvoices: Pick<SalesInvoiceRepository, "list">;
  readonly salesReturns: CockpitSalesReturns;
  readonly treasuryAccounts: { list(): Promise<readonly TreasuryAccount[]> };
  readonly cheques: { list(): Promise<readonly Cheque[]> };
  readonly wacSnapshots: { list(): Promise<readonly WacSnapshot[]> };
  readonly warehouses: { findAll(): Promise<readonly { readonly id: string; readonly branchId: string }[]> };
  readonly bookVersion: () => string;
  readonly today?: () => string;
  readonly now?: () => string;
}

function mayRead(c: Context, permission: string): boolean {
  const ctx = getAuthContext(c);
  return ctx ? can(ctx, permission) : false;
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

function viewOf(c: Context, requested: string): CockpitBranchView & { readonly narrowed: boolean; readonly empty: boolean } {
  const scope = branchScopeOf(c);
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
  c: Context,
  view: CockpitBranchView,
  treasury: readonly TreasuryAccount[],
  cheques: readonly Cheque[],
  today: string,
): Promise<CockpitCashDTO> {
  const underCollection = new Set(cheques.map((cheque) => cheque.controlAccounts.underCollectionAccountId));
  const scoped = withinScope(treasury, branchScopeOf(c), (t) => t.branchId).filter(
    (t) => view.branchId === "" || t.branchId === view.branchId,
  );
  const seen = new Set<string>(underCollection);
  const rows: CockpitTreasuryDTO[] = [];
  let total = 0n;
  for (const account of [...scoped].sort((a, b) => a.code.localeCompare(b.code))) {
    let balance: string | null = null;
    const gl = account.glAccountId;
    if (gl && !seen.has(gl)) {
      seen.add(gl);
      const held = (await deps.ledger.accountBalance(gl, today)).balance;
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
    });
  }
  return { total: Money.fromScaled(total).toString(), accounts: rows };
}

async function overdueSection(deps: CockpitRoutesDeps, c: Context, view: CockpitBranchView, today: string): Promise<CockpitOverdueDTO> {
  const invoices = (await deps.salesInvoices.list({ statusIn: [...OPEN_STATUSES], branchScope: branchScopeOf(c), warehouseScope: warehouseScopeOf(c) })).filter(
    (invoice) => view.branchId === "" || invoice.branchId === view.branchId,
  );
  const ids = invoices.map((invoice) => invoice.id);
  const docs = ids.length === 0
    ? []
    : deps.salesReturns.listByLineRef
      ? await deps.salesReturns.listByLineRef("sourceInvoiceId", ids, { status: "confirmed" })
      : await deps.salesReturns.list({ status: "confirmed" });
  const credits = salesReturnCreditByInvoice(docs);
  const summary = cockpitOverdue(
    invoices.map((invoice) => {
      const base = salesInvoiceBaseGrandTotal(salesInvoiceTotals(invoice), invoice.fxRate);
      const credit = credits.get(invoice.id) ?? Money.zero();
      return { customerId: invoice.customerId, dueDate: invoice.dueDate, remaining: base.scaled - invoice.amountPaid.scaled - credit.scaled };
    }),
    today,
  );
  return {
    amount: summary.amount.toString(),
    invoiceCount: summary.invoiceCount,
    customerCount: summary.customerCount,
    oldestDueDate: summary.oldestDueDate,
  };
}

async function lowStockSection(deps: CockpitRoutesDeps, c: Context, items: readonly Item[], view: CockpitBranchView): Promise<CockpitLowStockDTO> {
  const [snapshots, warehouses] = await Promise.all([deps.wacSnapshots.list(), deps.warehouses.findAll()]);
  const branchOf = new Map(warehouses.map((w) => [w.id, w.branchId]));
  const warehouseScope = warehouseScopeOf(c);
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
  c: Context,
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
      branchScope: branchScopeOf(c),
      warehouseScope: warehouseScopeOf(c),
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

export function createCockpitRoutes(deps: CockpitRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const todayOf = (c: Context) => tenantToday(c, deps.today);
  const nowOf = () => (deps.now ? deps.now() : new Date().toISOString());

  app.get("/version", gate(COCKPIT_PERMISSION), (c) => {
    const body: CockpitVersionDTO = { bookVersion: deps.bookVersion() };
    return c.json(body);
  });

  app.get("/cockpit", gate(COCKPIT_PERMISSION), async (c) => {
    const parsed = cockpitQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "INVALID_QUERY", message: "معايير لوحة المالك غير صالحة.", messageEn: "Invalid cockpit parameters.", issues: parsed.error.issues }, 400);
    }
    const bookVersion = deps.bookVersion();
    const today = await todayOf(c);
    const compareDate = cockpitAddDays(today, -COCKPIT_SPARK_DAYS);
    const sparkFrom = cockpitAddDays(today, -(COCKPIT_SPARK_DAYS - 1));
    const trendFrom = cockpitAddDays(today, -(COCKPIT_SPARK_DAYS * COCKPIT_MARGIN_WEEKS - 1));
    const view = viewOf(c, parsed.data.branchId);

    const withCost = mayRead(c, "sales.invoice.view_cost");
    const withSales = mayRead(c, "sales.invoice.view");
    const withCash = mayRead(c, "treasury.account.view");
    const withStock = mayRead(c, "inventory.item.view");

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
      withCash ? cashByTreasury(deps, c, view, view.empty ? [] : treasury, cheques, today) : Promise.resolve(null),
      withSales && !view.empty && view.branchId !== UNATTRIBUTED_BRANCH_ID ? overdueSection(deps, c, view, today) : Promise.resolve(null),
      withStock && !view.empty && view.branchId !== UNATTRIBUTED_BRANCH_ID ? lowStockSection(deps, c, items, view) : Promise.resolve(null),
      withSales && !view.empty && view.branchId !== UNATTRIBUTED_BRANCH_ID ? moversSection(deps, c, view, items, today) : Promise.resolve(null),
    ]);

    const money = (scaled: bigint) => Money.fromScaled(scaled).toString();
    const body: CockpitDTO = {
      generatedAt: nowOf(),
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
    return c.json(body);
  });

  return app;
}
