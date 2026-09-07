import { Hono, type Context } from "hono";
import {
  Money,
  type AllocatableInvoiceRepository,
  runReport,
  createSalesByPeriodReport,
  createSalesByItemReport,
  createSalesByCustomerReport,
  createSalesBySalespersonReport,
  createTopProductsReport,
  createPurchasesByPeriodReport,
  createPurchasesBySupplierReport,
  createPurchasesByItemReport,
  createInventoryStockLevelsReport,
  createInventoryMovementReport,
  createInventoryLedgerReport,
  createInventoryValuationReport,
  createInventoryAgingReport,
  createInventoryExpiringReport,
  createInventorySlowMovingReport,
  createInventoryDriftReport,
  createMakeVsBuyReport,
  createAgingCustomersReport,
  createAgingSuppliersReport,
  createInstallmentsOverviewReport,
  createInstallmentsOverdueReport,
  createVanSalesReport,
  createTrialBalanceReport,
  createIncomeStatementReport,
  createBalanceSheetReport,
  createCashFlowReport,
  createVatReturnReport,
  createWithholdingTaxReport,
  createGeneralLedgerReport,
  createAccountLedgerReport,
  OUTPUT_VAT_ACCOUNT_ID,
  INPUT_VAT_ACCOUNT_ID,
  ACCOUNT_TYPE_LABELS,
  SALES_INVOICE_ACTIVE_STATUSES,
  moneyToNumber,
  purchaseInvoiceTotal,
  salesInvoiceTotals,
  type GlReportContext,
  type SalesInvoiceRepository,
  type PurchaseInvoiceRepository,
  type CustomerRepository,
  type SupplierRepository,
  type ItemRepository,
  type BomRepository,
  type WarehouseRepository,
  type StockLedgerRepository,
  type CostLayerRepository,
  type WacSnapshotRepository,
  type DocumentRepository,
  type InstallmentLine,
  type LedgerRepository,
  type AccountRepository,
  type VanTripRepository,
  type EmployeeRepository,
  type RunReportOutcome,
  salesReturnGrandTotal,
  sumActive,
  type SalesReturnDocument,
  type ChequeRepository,
  type AllocationRepository,
  type VoucherLine,
} from "@mezan/domain";
import { branchScopeOf, createAnyPermissionGate, createPermissionGate, warehouseScopeOf, withinScope, type AuthContextResolver } from "./permission-gate.js";

/**
 * التقارير — operational reports (docs/archive/catalog/08-reports.md), mounted under
 * `/reports`. Every route follows the SAME shape: fetch the real persisted
 * rows this report needs (straight off the repositories other modules
 * already use — no report-specific data duplication), hand them to the
 * report engine's `runReport()` as `ctx`, and return its outcome verbatim.
 * All aggregation/validation lives in `@mezan/domain/reports/*` — this file
 * is wiring only.
 */
export interface ReportsRoutesDeps {
  readonly salesInvoices: SalesInvoiceRepository;
  /** Allocation sub-ledger — lets the aging reports deduct what has actually been settled. */
  readonly allocatable?: AllocatableInvoiceRepository;
  /** Confirmed sales returns, so the customer aging ladder nets the credits the GL already posted. */
  readonly salesReturnDocs?: { list(filter?: { status?: "confirmed" }): Promise<readonly SalesReturnDocument[]> };
  /** Cheques, whose creation already reclassified a customer's receivable. */
  readonly cheques?: Pick<ChequeRepository, "list">;
  /** Confirmed vouchers, for collections that named no invoice. */
  readonly voucherDocuments?: Pick<DocumentRepository<VoucherLine>, "list">;
  /** Allocations, to tell an applied collection from an on-account one. */
  readonly allocations?: Pick<AllocationRepository, "listByVoucher">;
  readonly purchaseInvoices: PurchaseInvoiceRepository;
  readonly customers: CustomerRepository;
  readonly suppliers: SupplierRepository;
  readonly items: ItemRepository;
  /**
   * التصنيع أم الشراء data source. Optional: the make-vs-buy report route is
   * only mounted when a composition wires the manufacturing module's BOMs,
   * so an app without manufacturing serves no make-vs-buy report at all
   * rather than an empty one.
   */
  readonly boms?: BomRepository;
  readonly warehouses: WarehouseRepository;
  readonly stockLedger: StockLedgerRepository;
  readonly costLayers: CostLayerRepository;
  readonly wacSnapshots: WacSnapshotRepository;
  readonly installmentPlans: DocumentRepository<InstallmentLine>;
  /**
   * القوائم المالية data source (docs/archive/catalog/08 — الميزان/قائمة الدخل/الميزانية/
   * التدفقات/الإقرار الضريبي/الأستاذ العام/دفتر حساب). The seven financial
   * statements aggregate over the SAME posted GL the journal/dashboard read —
   * `ledger` supplies the posted entries, `accounts` the chart to classify them.
   */
  readonly ledger: LedgerRepository;
  readonly accounts: AccountRepository;
  /**
   * مبيعات المندوبين data source. Optional: the van-sales report route is only
   * mounted when a composition actually wires field sales, so an app without
   * van trips serves no van-sales report at all rather than an empty one.
   */
  readonly vanTrips?: VanTripRepository;
  /** Resolves van-trip crew ids to employee names; ids are shown verbatim when absent. */
  readonly employees?: EmployeeRepository;
  /**
   * العروض master data, for a campaign's TYPE and English name. Optional: the
   * report still runs without it — every figure comes off the invoice's own
   * recorded promotion — and the type column is simply blank.
   */
  readonly promotions?: { list(): Promise<readonly { readonly id: string; readonly nameEn: string | null; readonly type: string }[]> };
  /** ISO `YYYY-MM-DD` "today" — overridable for tests; defaults to the real date. */
  readonly today?: () => string;
}

/**
 * The control accounts each by-item report ties back to. Kept here rather than
 * read from the account-routing table because a reconciliation must compare
 * against where the postings ACTUALLY went, not where a tenant has since
 * decided they should go.
 */
const REVENUE_ACCOUNT_IDS = ["4100"] as const;
const INVENTORY_ACCOUNT_IDS = ["1200"] as const;

/**
 * How many source documents a drill-down panel carries. Fixed here, never read
 * off the request: a limit the caller supplies is not a limit. The panel is
 * told the true total separately so it can say what it is not showing.
 */
const DRILL_DOWN_LIMIT = 25;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(deps: ReportsRoutesDeps): string {
  if (deps.today) return deps.today();
  // Local calendar day, not `toISOString()`: that is UTC, so it hands back
  // YESTERDAY for anyone east of Greenwich until the small hours — which is
  // everyone this product ships to.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function firstOfMonth(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function firstOfYear(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/**
 * The GL slice the account drill-down reads.
 *
 * REVERSED ENTRIES LOAD ALONGSIDE POSTED ONES. Reversing posts a mirror entry
 * (status `posted`) and marks the original `reversed`; loading only `posted`
 * therefore keeps the mirror and drops what it offsets, so every figure is
 * wrong by the reversal. This is the same slice
 * `financial-reports-routes.ts` loads, and the two must not diverge again —
 * they answer the same questions about the same ledger.
 */
async function loadGlContext(deps: ReportsRoutesDeps): Promise<GlReportContext> {
  const [accounts, posted, reversed] = await Promise.all([
    deps.accounts.list(),
    deps.ledger.list({ status: "posted" }),
    deps.ledger.list({ status: "reversed" }),
  ]);
  const journalEntries = [...posted, ...reversed].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { accounts, journalEntries };
}

/**
 * What a set of GL accounts took in on its NATURAL side over a date range —
 * the ledger half of a report's reconciliation (A7).
 *
 * Gross, not net, and that distinction is the whole point. Both by-item
 * reports sum what documents recorded: every sale, every purchase. The
 * matching ledger figure is therefore every credit to revenue and every debit
 * to inventory — NOT their net movement, which has had returns and cost of
 * goods sold taken back out of it and would report a difference on a set of
 * books that agree perfectly.
 */
async function postedGross(
  deps: ReportsRoutesDeps,
  accountIds: readonly string[],
  range: { dateFrom: string; dateTo: string },
  side: "debit" | "credit",
  /**
   * Restricts the ledger side to entries a given document type produced.
   * Inventory is debited by landed costs and opening balances as well as by
   * the purchase chain, so a purchases report compared against ALL inventory
   * debits reports a difference on books that agree — the figures are simply
   * not the same question. Available because journal entries carry the document
   * that made them (R6.3).
   *
   * The purchase chain needs BOTH of its document types: since D53 a receipt
   * debits inventory and its invoice clears GRNI instead, while an invoice
   * raised with no receipt behind it still debits inventory itself. Naming only
   * one of the two counts half the purchases.
   */
  sourceDocTypes?: readonly string[],
): Promise<number> {
  // One SQL aggregate where the ledger can answer it (Q-6); the fold survives
  // for in-memory ledgers and must produce the same figure.
  if (deps.ledger.sumLines) {
    const sums = await deps.ledger.sumLines({
      statuses: ["posted"],
      fromDate: range.dateFrom,
      toDate: range.dateTo,
      accountIds,
      ...(sourceDocTypes ? { sourceDocTypes } : {}),
    });
    return Number(sums[side].toString());
  }
  const entries = await deps.ledger.list({ status: "posted" });
  const allowed = new Set(accountIds);
  let total = 0;
  for (const entry of entries) {
    if (entry.date < range.dateFrom || entry.date > range.dateTo) continue;
    if (sourceDocTypes && !sourceDocTypes.includes(entry.sourceDocType ?? "")) continue;
    for (const line of entry.lines) {
      if (!allowed.has(line.accountId)) continue;
      const amount = side === "debit" ? line.debit : line.credit;
      total += amount.toScaledNumber() / 1_000_000;
    }
  }
  return total;
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

/**
 * Every stock movement across every position — the shared ledger the inventory
 * reports slice differently.
 *
 * ONE query when the store can answer it (Q-6: this was a synchronous SQLite
 * round trip per position, 12,001 of them on the reference database). The
 * per-position fallback survives for stores without `listAll`, and returns the
 * array in the SAME order, which `listAll`'s contract exists to guarantee.
 */
async function loadAllMovements(deps: ReportsRoutesDeps) {
  if (deps.stockLedger.listAll) return deps.stockLedger.listAll();
  const positions = await deps.stockLedger.listPositions();
  const lists = await Promise.all(positions.map((p) => deps.stockLedger.listByPosition(p.itemId, p.warehouseId)));
  return lists.flat();
}

/** Every cost layer across every position (aging + drift both need the full set). */
async function loadAllLayers(deps: ReportsRoutesDeps) {
  if (deps.costLayers.listAll) return deps.costLayers.listAll();
  const positions = await deps.stockLedger.listPositions();
  const lists = await Promise.all(positions.map((p) => deps.costLayers.listByPosition(p.itemId, p.warehouseId)));
  return lists.flat();
}

/**
 * Customer credits that no invoice claims: an incoming cheque (which credited AR
 * the moment it was written) and the unallocated remainder of a confirmed
 * collection. Without them the aging ladder reports debt the ledger has already
 * cleared, and the dashboard's receivables tile and this report disagree (D37).
 */
async function unappliedCustomerCredits(deps: ReportsRoutesDeps): Promise<ReadonlyMap<string, Money>> {
  const out = new Map<string, bigint>();
  const add = (partyId: string | null | undefined, scaled: bigint) => {
    if (!partyId || scaled <= 0n) return;
    out.set(partyId, (out.get(partyId) ?? 0n) + scaled);
  };

  for (const cheque of (await deps.cheques?.list({ direction: "incoming" })) ?? []) {
    if (cheque.direction !== "incoming") continue;
    // A bounced or replaced cheque credited nothing that still stands: bouncing
    // reclassifies GL 1320 → 1360 and deliberately leaves AR where it is. Counting
    // it here netted the debt back out of the ladder, so a customer who paid with a
    // cheque that bounced dropped out of collections while still owing the money.
    if (cheque.status === "bounced" || cheque.status === "replaced") continue;
    if (cheque.counterpartyGlAccountId !== "1105") continue;
    add(cheque.partyId, cheque.amount.scaled);
  }

  for (const doc of (await deps.voucherDocuments?.list({ status: "confirmed" })) ?? []) {
    const line = doc.lines[0];
    if (!line || line.direction !== "receipt") continue;
    if (line.counterpartyGlAccountId !== "1105") continue;
    const allocated = deps.allocations ? sumActive(await deps.allocations.listByVoucher(doc.id)).scaled : 0n;
    add(line.customerId, line.amount.scaled - allocated);
  }

  return new Map([...out].map(([id, scaled]) => [id, Money.fromScaled(scaled)]));
}

/** Confirmed sales-return credit per source invoice. */
async function returnsByInvoiceId(deps: ReportsRoutesDeps): Promise<ReadonlyMap<string, Money>> {
  const out = new Map<string, bigint>();
  for (const doc of (await deps.salesReturnDocs?.list({ status: "confirmed" })) ?? []) {
    if (doc.status !== "confirmed") continue;
    const invoiceId = doc.lines[0]?.sourceInvoiceId;
    if (!invoiceId) continue;
    out.set(invoiceId, (out.get(invoiceId) ?? 0n) + salesReturnGrandTotal(doc).scaled);
  }
  return new Map([...out].map(([id, scaled]) => [id, Money.fromScaled(scaled)]));
}

/**
 * How much of each of these invoices the allocation sub-ledger records as
 * settled.
 *
 * It asks by ID, never through `listOpen`: that query is `total > allocated`,
 * so a FULLY settled invoice is absent from its result, the caller reads the
 * missing entry as zero allocated, and the document is reported as owing its
 * whole value. Sales survived it because `aging.customers` falls back to the
 * invoice's own `amountPaid`; a purchase invoice carries no such counter, so
 * `aging.suppliers` restated every paid supplier bill as outstanding (D66).
 */
async function settledByInvoiceId(
  deps: ReportsRoutesDeps,
  invoices: readonly { readonly id: string }[],
): Promise<ReadonlyMap<string, Money>> {
  if (!deps.allocatable) return new Map();
  return deps.allocatable.allocatedByIds(invoices.map((invoice) => invoice.id));
}

/**
 * The branches a report may cover (P-7).
 *
 * `branchScopeOf` is the SCOPE — what this session is allowed to see at all —
 * and `?branchId=` is a presentation filter that may only narrow it. A
 * `branchId` the session may not see resolves to no branches rather than
 * widening the scope, which is the whole point of a scope.
 */
function reportBranches(c: Context): readonly string[] | undefined {
  const scope = branchScopeOf(c);
  const requested = (c.req.query("branchId") ?? "").trim();
  if (requested === "" || requested === "*") return scope;
  if (scope && !scope.includes(requested)) return [];
  return [requested];
}

export function createReportsRoutes(
  deps: ReportsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);

  /** The warehouses inside the report's branch scope, for the stock reports the branch reaches only through them. */
  async function warehousesInBranchScope(c: Context): Promise<readonly string[] | undefined> {
    const branches = reportBranches(c);
    if (!branches) return warehouseScopeOf(c);
    const allowed = new Set(branches);
    const inBranch = (await deps.warehouses.findAll()).filter((w) => allowed.has(w.branchId)).map((w) => w.id);
    const byWarehouse = warehouseScopeOf(c);
    return byWarehouse ? inBranch.filter((id) => byWarehouse.includes(id)) : inBranch;
  }

  function scopedSalesInvoices<T extends { readonly branchId?: string | null }>(c: Context, rows: readonly T[]): readonly T[] {
    return withinScope(rows, reportBranches(c), (r) => r.branchId);
  }

  /**
   * An instalment plan carries no branch of its own; its branch is the branch
   * of the sales invoice it was raised against, which is a resolution, not a
   * guess. A plan whose source invoice is gone stays unattributed.
   */
  async function scopedPlans<T extends { readonly lines: readonly { readonly sourceInvoiceId: string }[] }>(
    c: Context,
    plans: readonly T[],
  ): Promise<readonly T[]> {
    const branches = reportBranches(c);
    if (!branches) return plans;
    const branchByInvoiceId = new Map((await deps.salesInvoices.list()).map((i) => [i.id, i.branchId]));
    return withinScope(plans, branches, (p) => {
      const sourceId = p.lines[0]?.sourceInvoiceId;
      return sourceId ? branchByInvoiceId.get(sourceId) ?? null : null;
    });
  }

  function queryParams(c: Context): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of new URL(c.req.url).searchParams) out[key] = value;
    return out;
  }

  // --- المبيعات ------------------------------------------------------

  app.get("/sales/by-period", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByPeriodReport(firstOfMonth(today), today);
    const invoices = scopedSalesInvoices(c, await deps.salesInvoices.list());
    const allocatedByInvoiceId = await settledByInvoiceId(deps, invoices);
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, allocatedByInvoiceId }),
    );
  });

  app.get("/sales/by-item", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByItemReport(firstOfMonth(today), today);
    const [allInvoices, items] = await Promise.all([deps.salesInvoices.list(), deps.items.list()]);
    const invoices = scopedSalesInvoices(c, allInvoices);
    const allocatedByInvoiceId = await settledByInvoiceId(deps, invoices);
    const params = { ...definition.defaultParams, ...queryParams(c) };
    const postedRevenue = await postedGross(deps, REVENUE_ACCOUNT_IDS, params as { dateFrom: string; dateTo: string }, "credit", ["SALES_INVOICE"]);
    return respond(c, runReport(definition, params, { invoices, items, allocatedByInvoiceId, postedRevenue: () => postedRevenue }));
  });

  app.get("/sales/by-customer", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByCustomerReport(firstOfMonth(today), today);
    const [allInvoices, customers] = await Promise.all([deps.salesInvoices.list(), deps.customers.findAll()]);
    const invoices = scopedSalesInvoices(c, allInvoices);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, customers }));
  });

  app.get("/sales/by-salesperson", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesBySalespersonReport(firstOfMonth(today), today);
    const invoices = scopedSalesInvoices(c, await deps.salesInvoices.list());
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices }));
  });

  app.get("/sales/top-products", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createTopProductsReport(firstOfMonth(today), today);
    const [allInvoices, items] = await Promise.all([deps.salesInvoices.list(), deps.items.list()]);
    const invoices = scopedSalesInvoices(c, allInvoices);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, items }));
  });

  /**
   * تقرير العروض — the promotions report (docs/archive/catalog/08-reports.md:87,
   * fully specified in 01-sales.md §"تقرير العروض"). The one catalogue report
   * with no route at all (P-8).
   *
   * What it answers: how much was given away through promotions in a period,
   * per campaign, net of what the returns handed back. Every figure comes off
   * documents that were actually posted — the promotion the invoice RECORDED
   * (`appliedPromotion`, stamped at confirm), never a re-evaluation of today's
   * campaign rules against yesterday's invoice, which would restate history
   * every time someone edits a promotion.
   *
   * «خصم معكوس» is pro-rated per returned line: a return of 3 of the 10 units
   * a promotion discounted reverses three tenths of that line's discount. The
   * alternative — reversing a campaign's whole discount on any return against
   * the invoice — overstates the reversal and can drive the net negative.
   *
   * Money is summed in `Money` and converted once per emitted figure, at the
   * response boundary.
   */
  app.get("/sales/offers", gateAny("sales.promotion.view", "sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const params = { dateFrom: firstOfMonth(today), dateTo: today, ...queryParams(c) };
    if (!ISO_DATE.test(params.dateFrom) || !ISO_DATE.test(params.dateTo)) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          errors: [
            ...(ISO_DATE.test(params.dateFrom) ? [] : [{ path: "dateFrom", messageAr: "تاريخ غير صالح" }]),
            ...(ISO_DATE.test(params.dateTo) ? [] : [{ path: "dateTo", messageAr: "تاريخ غير صالح" }]),
          ],
        },
        400,
      );
    }

    const [allInvoices, promotions, returns] = await Promise.all([
      deps.salesInvoices.list(),
      deps.promotions?.list() ?? Promise.resolve([]),
      deps.salesReturnDocs?.list() ?? Promise.resolve([]),
    ]);
    const invoices = scopedSalesInvoices(c, allInvoices);

    const promotionById = new Map(promotions.map((promotion) => [promotion.id, promotion]));

    interface Agg {
      code: string;
      nameAr: string;
      nameEn: string | null;
      type: string;
      uses: number;
      granted: Money;
      reversed: Money;
    }
    const byPromotion = new Map<string, Agg>();
    /** Invoices in range that carry a promotion — the only ones a return can reverse against. */
    const inRange = new Map<string, (typeof invoices)[number]>();

    for (const invoice of invoices) {
      if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
      if (invoice.date < params.dateFrom || invoice.date > params.dateTo) continue;
      const applied = invoice.appliedPromotion;
      if (!applied) continue;
      inRange.set(invoice.id, invoice);
      const master = promotionById.get(applied.promotionId);
      const existing = byPromotion.get(applied.promotionId) ?? {
        code: applied.code,
        nameAr: applied.nameAr,
        nameEn: master?.nameEn ?? null,
        type: master?.type ?? "",
        uses: 0,
        granted: Money.zero(),
        reversed: Money.zero(),
      };
      existing.uses += 1;
      existing.granted = existing.granted.add(applied.discountTotal);
      byPromotion.set(applied.promotionId, existing);
    }

    for (const doc of returns) {
      if (doc.status !== "confirmed") continue;
      if (doc.date < params.dateFrom || doc.date > params.dateTo) continue;
      for (const line of doc.lines) {
        const invoice = inRange.get(line.sourceInvoiceId);
        const applied = invoice?.appliedPromotion;
        if (!invoice || !applied) continue;
        const agg = byPromotion.get(applied.promotionId);
        if (!agg) continue;
        const discountedForItem = Money.sum(
          applied.lineDiscounts.filter((d) => d.itemId === line.itemId).map((d) => d.amount),
        );
        if (discountedForItem.scaled === 0n) continue;
        const invoicedQty = invoice.lines
          .filter((l) => l.itemId === line.itemId)
          .reduce<bigint>((total, l) => total + l.qty.scaled, 0n);
        if (invoicedQty === 0n) continue;
        const share = (discountedForItem.scaled * line.qty.scaled) / invoicedQty;
        agg.reversed = agg.reversed.add(Money.fromScaled(share));
      }
    }

    const rows = [...byPromotion.entries()]
      .map(([promotionId, agg]) => ({
        promotionId,
        code: agg.code,
        nameAr: agg.nameAr,
        nameEn: agg.nameEn,
        type: agg.type,
        uses: agg.uses,
        granted: moneyToNumber(agg.granted),
        reversed: moneyToNumber(agg.reversed),
        net: moneyToNumber(Money.fromScaled(agg.granted.scaled - agg.reversed.scaled)),
      }))
      .sort((a, b) => b.net - a.net);

    const sum = (pick: (row: (typeof rows)[number]) => number): number => rows.reduce((total, row) => total + pick(row), 0);

    return c.json({
      params,
      rows,
      groups: [],
      grandTotals: {
        uses: sum((r) => r.uses),
        granted: sum((r) => r.granted),
        reversed: sum((r) => r.reversed),
        net: sum((r) => r.net),
      },
      reconciliation: null,
      kpis: [
        { key: "promotionsUsed", labelAr: "عروض مستخدمة", format: "qty" as const, value: rows.length },
        { key: "uses", labelAr: "عدد مرات الاستخدام", format: "qty" as const, value: sum((r) => r.uses) },
        { key: "granted", labelAr: "إجمالي الخصم الممنوح", format: "money" as const, value: sum((r) => r.granted) },
        { key: "net", labelAr: "صافي الخصم", format: "money" as const, value: sum((r) => r.net) },
      ],
    });
  });

  // --- المشتريات -----------------------------------------------------

  app.get("/purchases/by-period", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesByPeriodReport(firstOfMonth(today), today);
    const invoices = scopedSalesInvoices(c, await deps.purchaseInvoices.list());
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices }));
  });

  app.get("/purchases/by-supplier", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesBySupplierReport(firstOfMonth(today), today);
    const [allInvoices, suppliers] = await Promise.all([deps.purchaseInvoices.list(), deps.suppliers.findAll()]);
    const invoices = scopedSalesInvoices(c, allInvoices);
    const allocatedByInvoiceId = await settledByInvoiceId(deps, invoices);
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, suppliers, allocatedByInvoiceId }),
    );
  });

  app.get("/purchases/by-item", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesByItemReport(firstOfMonth(today), today);
    const [allInvoices, items] = await Promise.all([deps.purchaseInvoices.list(), deps.items.list()]);
    const invoices = scopedSalesInvoices(c, allInvoices);
    const params = { ...definition.defaultParams, ...queryParams(c) };
    const postedInventory = await postedGross(deps, INVENTORY_ACCOUNT_IDS, params as { dateFrom: string; dateTo: string }, "debit", ["PURCHASE_INVOICE", "PURCHASE_RECEIPT"]);
    return respond(c, runReport(definition, params, { invoices, items, postedInventory: () => postedInventory }));
  });

  // --- المخزون -------------------------------------------------------

  app.get("/inventory/stock-levels", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryStockLevelsReport();
    const [items, allSnapshots] = await Promise.all([deps.items.list(), deps.wacSnapshots.list()]);
    const snapshots = withinScope(allSnapshots, await warehousesInBranchScope(c), (s) => s.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots }));
  });

  app.get("/inventory/movement", gate("inventory.stock.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createInventoryMovementReport(firstOfMonth(today), today);
    const [allMovements, items, warehouses] = await Promise.all([loadAllMovements(deps), deps.items.list(), deps.warehouses.findAll()]);
    const movements = withinScope(allMovements, await warehousesInBranchScope(c), (m) => m.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { movements, items, warehouses }));
  });

  app.get("/inventory/ledger", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryLedgerReport();
    const [allMovements, items, warehouses] = await Promise.all([loadAllMovements(deps), deps.items.list(), deps.warehouses.findAll()]);
    const movements = withinScope(allMovements, await warehousesInBranchScope(c), (m) => m.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { movements, items, warehouses }));
  });

  app.get("/inventory/valuation", gate("inventory.valuation.view"), async (c) => {
    const definition = createInventoryValuationReport();
    const [items, allSnapshots] = await Promise.all([deps.items.list(), deps.wacSnapshots.list()]);
    const snapshots = withinScope(allSnapshots, await warehousesInBranchScope(c), (s) => s.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots }));
  });

  app.get("/inventory/aging", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryAgingReport(todayIso(deps));
    const [items, warehouses, allLayers] = await Promise.all([deps.items.list(), deps.warehouses.findAll(), loadAllLayers(deps)]);
    const layers = withinScope(allLayers, await warehousesInBranchScope(c), (l) => l.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, warehouses, layers }));
  });

  app.get("/inventory/expiring", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryExpiringReport(todayIso(deps));
    const [items, warehouses, allLayers] = await Promise.all([deps.items.list(), deps.warehouses.findAll(), loadAllLayers(deps)]);
    const layers = withinScope(allLayers, await warehousesInBranchScope(c), (l) => l.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, warehouses, layers }));
  });

  app.get("/inventory/slow-moving", gate("inventory.stock.view"), async (c) => {
    const definition = createInventorySlowMovingReport(todayIso(deps));
    const [items, allSnapshots, allInvoices] = await Promise.all([deps.items.list(), deps.wacSnapshots.list(), deps.salesInvoices.list()]);
    const warehouseScope = await warehousesInBranchScope(c);
    const snapshots = withinScope(allSnapshots, warehouseScope, (s) => s.warehouseId);
    const invoices = scopedSalesInvoices(c, allInvoices);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots, invoices }));
  });

  app.get("/inventory/drift", gate("inventory.valuation.view"), async (c) => {
    const definition = createInventoryDriftReport();
    const [allSnapshots, allMovements, items, warehouses] = await Promise.all([
      deps.wacSnapshots.list(),
      loadAllMovements(deps),
      deps.items.list(),
      deps.warehouses.findAll(),
    ]);
    const warehouseScope = await warehousesInBranchScope(c);
    const snapshots = withinScope(allSnapshots, warehouseScope, (s) => s.warehouseId);
    const movements = withinScope(allMovements, warehouseScope, (m) => m.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { snapshots, movements, items, warehouses }));
  });

  // --- التصنيع أم الشراء -----------------------------------------------

  if (deps.boms) {
    const boms = deps.boms;
    app.get("/manufacturing/make-vs-buy", gate("manufacturing.bom.view"), async (c) => {
      const definition = createMakeVsBuyReport();
      const [items, bomList, allInvoices] = await Promise.all([deps.items.list(), boms.list(), deps.purchaseInvoices.list()]);
      const invoices = scopedSalesInvoices(c, allInvoices);
      return respond(
        c,
        runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, boms: bomList, purchaseInvoices: invoices }),
      );
    });
  }

  // --- أعمار الديون ---------------------------------------------------

  app.get("/aging/customers", gate("sales.invoice.view"), async (c) => {
    const definition = createAgingCustomersReport(todayIso(deps));
    const params = { ...definition.defaultParams, ...queryParams(c) };
    // The ladder drops every invoice that is not live and every one dated after
    // the snapshot, so both bounds belong in SQL rather than in a fold over the
    // whole table (Q-6). The set here must stay exactly the report's own.
    const bounds = {
      statusIn: [...SALES_INVOICE_ACTIVE_STATUSES],
      ...(ISO_DATE.test(String(params.asOfDate)) ? { toDate: String(params.asOfDate) } : {}),
    };
    const [allInvoices, returns, credits, customers] = await Promise.all([
      deps.salesInvoices.list(bounds),
      returnsByInvoiceId(deps),
      unappliedCustomerCredits(deps),
      deps.customers.findAll(),
    ]);
    const invoices = scopedSalesInvoices(c, allInvoices);
    const allocatedByInvoiceId = await settledByInvoiceId(deps, invoices);
    return respond(
      c,
      runReport(definition, params, {
        invoices,
        customers,
        allocatedByInvoiceId,
        returnsByInvoiceId: returns,
        unappliedCreditsByCustomerId: credits,
      }),
    );
  });

  app.get("/aging/suppliers", gate("purchases.invoice.view"), async (c) => {
    const definition = createAgingSuppliersReport(todayIso(deps));
    const params = { ...definition.defaultParams, ...queryParams(c) };
    // Same two bounds as the customer ladder, and the same rule: the SQL set
    // must be exactly what the report itself would have kept (Q-6).
    const bounds = {
      status: "confirmed" as const,
      ...(ISO_DATE.test(String(params.asOfDate)) ? { toDate: String(params.asOfDate) } : {}),
    };
    const [allInvoices, suppliers] = await Promise.all([deps.purchaseInvoices.list(bounds), deps.suppliers.findAll()]);
    const invoices = scopedSalesInvoices(c, allInvoices);
    const allocatedByInvoiceId = await settledByInvoiceId(deps, invoices);
    return respond(c, runReport(definition, params, { invoices, suppliers, allocatedByInvoiceId }));
  });

  // --- الأقساط ---------------------------------------------------------

  app.get("/installments/overview", gate("installments.plan.view"), async (c) => {
    const definition = createInstallmentsOverviewReport(todayIso(deps));
    const [allPlans, customers] = await Promise.all([deps.installmentPlans.list(), deps.customers.findAll()]);
    const plans = await scopedPlans(c, allPlans);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { plans, customers }));
  });

  app.get("/installments/overdue", gate("installments.plan.view"), async (c) => {
    const definition = createInstallmentsOverdueReport(todayIso(deps));
    const [allPlans, customers] = await Promise.all([deps.installmentPlans.list(), deps.customers.findAll()]);
    const plans = await scopedPlans(c, allPlans);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { plans, customers }));
  });

  // --- المبيعات الميدانية ------------------------------------------------

  if (deps.vanTrips) {
    const vanTrips = deps.vanTrips;
    app.get("/field/van-sales", gate("field.van_trip.view"), async (c) => {
      const today = todayIso(deps);
      const definition = createVanSalesReport(firstOfMonth(today), today);
      const [allTrips, employees] = await Promise.all([vanTrips.list(), deps.employees?.list() ?? []]);
      const trips = withinScope(allTrips, reportBranches(c), (t) => t.branchId);
      return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { trips, employees }));
    });
  }

  // --- القوائم المالية — Financial statements (docs/archive/catalog/08) -------------
  // The seven statements below all compute from the REAL posted GL (loadGlContext),
  // never a fixture ledger. Each recreates the SAME `ReportDefinition` the web
  // screen renders through, so params/columns/reconciliation can never drift.

  app.get("/tax/withholding", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createWithholdingTaxReport(firstOfYear(today), today);
    const [allVouchers, suppliers] = await Promise.all([
      deps.voucherDocuments?.list({ status: "confirmed" }) ?? Promise.resolve([]),
      deps.suppliers.findAll(),
    ]);
    const vouchers = withinScope(allVouchers, reportBranches(c), (v) => v.lines[0]?.branchId);
    const supplierName = new Map(suppliers.map((s) => [s.id, s.nameAr]));
    const rows = vouchers.flatMap((doc) => {
      const line = doc.lines[0];
      const withheld = line?.withholdingAmount;
      if (!line || !withheld || withheld.scaled <= 0n) return [];
      return [{
        voucherId: doc.id,
        voucherNo: doc.docNo,
        date: doc.date,
        partyId: line.supplierId,
        partyNameAr: (line.supplierId && supplierName.get(line.supplierId)) || "—",
        grossAmount: line.amount,
        ratePercent: line.withholdingRatePercent ?? null,
        withheldAmount: withheld,
      }];
    });
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { rows }));
  });

  // --- التفاصيل — drill-down from an entity cell (A5) ----------------------
  // A report row is an aggregate. The only honest answer to "what is this
  // figure made of" is the documents that produced it, resolved here from the
  // posted records — never re-sliced in the browser out of the loaded page.

  app.get("/drill-down/customer/:id", gate("sales.customer.view"), async (c) => {
    const id = c.req.param("id");
    const [customers, invoices] = await Promise.all([deps.customers.findAll(), deps.salesInvoices.list()]);
    const customer = customers.find((entry) => entry.id === id);
    if (!customer) return c.json({ error: "NOT_FOUND" }, 404);
    const own = invoices
      .filter((invoice) => invoice.customerId === id && SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status))
      .sort((a, b) => b.date.localeCompare(a.date));
    let outstanding = 0n;
    let billed = 0n;
    for (const invoice of own) {
      const totals = salesInvoiceTotals(invoice);
      billed += totals.grandTotal.scaled;
      const balance = totals.grandTotal.scaled - invoice.amountPaid.scaled;
      if (balance > 0n) outstanding += balance;
    }
    return c.json({
      kind: "customer",
      id,
      titleAr: customer.nameAr,
      subtitleAr: customer.code,
      facts: [
        { key: "phone", labelAr: "الهاتف", value: customer.phone ?? "—" },
        { key: "creditLimit", labelAr: "حد الائتمان", value: customer.creditLimit.toString(), format: "money" },
        { key: "billed", labelAr: "إجمالي المفوتر", value: (Number(billed) / 1e6).toFixed(2), format: "money" },
        { key: "outstanding", labelAr: "المستحق", value: (Number(outstanding) / 1e6).toFixed(2), format: "money" },
      ],
      documents: own.slice(0, DRILL_DOWN_LIMIT).map((invoice) => ({
        id: invoice.id,
        docNo: invoice.docNo ?? invoice.id,
        date: invoice.date,
        type: "SALES_INVOICE",
        status: invoice.status,
        amount: moneyToNumber(salesInvoiceTotals(invoice).grandTotal),
        amountFormat: "money",
      })),
      documentCount: own.length,
    });
  });

  app.get("/drill-down/supplier/:id", gate("purchases.supplier.view"), async (c) => {
    const id = c.req.param("id");
    const [suppliers, invoices] = await Promise.all([deps.suppliers.findAll(), deps.purchaseInvoices.list()]);
    const supplier = suppliers.find((entry) => entry.id === id);
    if (!supplier) return c.json({ error: "NOT_FOUND" }, 404);
    const own = invoices
      .filter((invoice) => invoice.supplierId === id && invoice.status === "confirmed")
      .sort((a, b) => b.date.localeCompare(a.date));
    let billed = 0n;
    for (const invoice of own) billed += purchaseInvoiceTotal(invoice).scaled;
    return c.json({
      kind: "supplier",
      id,
      titleAr: supplier.nameAr,
      subtitleAr: supplier.code,
      facts: [
        { key: "phone", labelAr: "الهاتف", value: supplier.phone ?? "—" },
        { key: "paymentTermsDays", labelAr: "مهلة السداد (يوم)", value: String(supplier.paymentTermsDays), format: "qty" },
        { key: "billed", labelAr: "إجمالي المشتريات", value: (Number(billed) / 1e6).toFixed(2), format: "money" },
        { key: "invoiceCount", labelAr: "عدد الفواتير", value: String(own.length), format: "qty" },
      ],
      documents: own.slice(0, DRILL_DOWN_LIMIT).map((invoice) => ({
        id: invoice.id,
        docNo: invoice.number,
        date: invoice.date,
        type: "PURCHASE_INVOICE",
        status: invoice.status,
        amount: moneyToNumber(purchaseInvoiceTotal(invoice)),
        amountFormat: "money",
      })),
      documentCount: own.length,
    });
  });

  app.get("/drill-down/item/:id", gate("inventory.item.view"), async (c) => {
    const id = c.req.param("id");
    const [items, snapshots] = await Promise.all([deps.items.list(), deps.wacSnapshots.list()]);
    const item = items.find((entry) => entry.id === id);
    if (!item) return c.json({ error: "NOT_FOUND" }, 404);
    const positions = withinScope(
      snapshots.filter((snapshot) => snapshot.itemId === id),
      warehouseScopeOf(c),
      (snapshot) => snapshot.warehouseId,
    );
    let onHand = 0n;
    let value = 0n;
    for (const position of positions) {
      onHand += position.onHand.scaled;
      value += position.totalValue.scaled;
    }
    const movements = (await loadAllMovements(deps))
      .filter((movement) => movement.itemId === id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return c.json({
      kind: "item",
      id,
      titleAr: item.nameAr,
      subtitleAr: item.code,
      facts: [
        { key: "unit", labelAr: "الوحدة", value: item.baseUnitCode },
        { key: "onHand", labelAr: "المخزون الحالي", value: (Number(onHand) / 1e6).toString(), format: "qty" },
        { key: "value", labelAr: "قيمة المخزون", value: (Number(value) / 1e6).toFixed(2), format: "money" },
        { key: "warehouseCount", labelAr: "عدد المستودعات", value: String(positions.length), format: "qty" },
      ],
      documents: movements.slice(0, DRILL_DOWN_LIMIT).map((movement) => ({
        id: movement.sourceDocId,
        docNo: movement.sourceDocNumber ?? movement.sourceDocId,
        date: movement.occurredAt.slice(0, 10),
        type: "STOCK_MOVEMENT",
        status: movement.direction,
        amount: Number(movement.qty.toString()),
        amountFormat: "qty",
      })),
      documentCount: movements.length,
    });
  });

  app.get("/drill-down/account/:id", gate("accounting.reports.view"), async (c) => {
    const id = c.req.param("id");
    const ctx = await loadGlContext(deps);
    const account = ctx.accounts.find((entry) => entry.id === id);
    if (!account) return c.json({ error: "NOT_FOUND" }, 404);
    let debit = 0n;
    let credit = 0n;
    const touching: { id: string; docNo: string; date: string; net: bigint }[] = [];
    for (const entry of ctx.journalEntries) {
      let net = 0n;
      let touched = false;
      for (const line of entry.lines) {
        if (line.accountId !== id) continue;
        touched = true;
        debit += line.debit.scaled;
        credit += line.credit.scaled;
        net += line.debit.scaled - line.credit.scaled;
      }
      if (touched) touching.push({ id: entry.id, docNo: entry.entryNo ?? entry.id, date: entry.date, net });
    }
    touching.sort((a, b) => b.date.localeCompare(a.date));
    return c.json({
      kind: "account",
      id,
      titleAr: account.nameAr,
      subtitleAr: account.code,
      facts: [
        { key: "type", labelAr: "نوع الحساب", value: ACCOUNT_TYPE_LABELS[account.type] },
        { key: "debit", labelAr: "إجمالي المدين", value: (Number(debit) / 1e6).toFixed(2), format: "money" },
        { key: "credit", labelAr: "إجمالي الدائن", value: (Number(credit) / 1e6).toFixed(2), format: "money" },
        { key: "balance", labelAr: "الرصيد", value: (Number(debit - credit) / 1e6).toFixed(2), format: "money" },
      ],
      documents: touching.slice(0, DRILL_DOWN_LIMIT).map((entry) => ({
        id: entry.id,
        docNo: entry.docNo,
        date: entry.date,
        type: "JOURNAL_ENTRY",
        status: "posted",
        amount: Number(entry.net) / 1e6,
        amountFormat: "money",
      })),
      documentCount: touching.length,
    });
  });

  return app;
}
