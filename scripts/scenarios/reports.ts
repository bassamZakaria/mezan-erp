import type { Ctx } from "./harness.js";

/**
 * التقارير — the reports engine (A2 / R21.2, R6.6, A5).
 *
 * Two claims are worth testing here and they are the whole point of the KPI
 * strip. First, a headline figure must tie to the ledger: it is computed
 * server-side over the WHOLE filtered result, from the same rows and the same
 * addition as the grand-total row, so the two can never disagree. Second, a
 * filter must move both — a strip that stays put while the table narrows is
 * reporting the wrong set.
 *
 * See docs/TESTING.md §15.
 */

interface Kpi {
  readonly key: string;
  readonly labelAr: string;
  readonly format?: string;
  readonly value: number;
}

function kpi(body: any, key: string): number {
  const found = (body?.kpis as Kpi[] | undefined)?.find((entry) => entry.key === key);
  return found ? found.value : Number.NaN;
}

/** Every report route, with a range wide enough that the seeded tenant fills it. */
const ALL_REPORTS: readonly string[] = [
  "/reports/sales/by-period?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/sales/by-item?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/sales/by-customer?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/sales/by-salesperson?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/sales/top-products?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/purchases/by-period?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/purchases/by-supplier?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/purchases/by-item?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/inventory/stock-levels",
  "/reports/inventory/movement?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/reports/inventory/ledger",
  "/reports/inventory/valuation",
  "/reports/inventory/aging",
  "/reports/inventory/expiring",
  "/reports/inventory/slow-moving",
  "/reports/inventory/drift",
  "/reports/manufacturing/make-vs-buy",
  "/reports/aging/customers",
  "/reports/aging/suppliers",
  "/reports/installments/overview",
  "/reports/installments/overdue",
  "/reports/field/van-sales?dateFrom=2026-01-01&dateTo=2026-12-31",
  "/financial-reports/trial-balance",
  "/financial-reports/income-statement?periodFrom=2026-01-01&periodTo=2026-12-31",
  "/financial-reports/balance-sheet",
  "/financial-reports/cash-flow?periodFrom=2026-01-01&periodTo=2026-12-31",
  "/financial-reports/vat-return?periodFrom=2026-01-01&periodTo=2026-12-31",
  "/reports/tax/withholding?fromDate=2026-01-01&toDate=2026-12-31",
  "/financial-reports/general-ledger?periodFrom=2026-01-01&periodTo=2026-12-31",
];

export async function run(ctx: Ctx): Promise<void> {
  await everyReportCarriesAKpiStrip_R212(ctx);
  await headlineFiguresTieToTheLedger_R212(ctx);
  await aFilterMovesBothRowsAndKpi_R212(ctx);
  await drillDownAnswersFromTheSourceDocuments_A5(ctx);
}

async function everyReportCarriesAKpiStrip_R212(ctx: Ctx): Promise<void> {
  await ctx.scenario("R21.2 — every report answers with a summary strip, computed server-side", async () => {
    for (const path of ALL_REPORTS) {
      const label = path.split("?")[0]!.replace("/reports/", "");
      const res = await ctx.req("GET", path);
      ctx.check(`${label} runs`, res.status === 200, `status ${res.status}`);
      if (res.status !== 200) continue;
      const kpis = (res.body?.kpis ?? []) as Kpi[];
      ctx.check(`${label} carries KPIs`, kpis.length >= 3, `${kpis.length} kpis`);
      ctx.check(
        `${label} KPI values are all real numbers`,
        kpis.every((entry) => typeof entry.value === "number" && Number.isFinite(entry.value)),
        JSON.stringify(kpis).slice(0, 200),
      );
      ctx.check(
        `${label} every KPI is labelled in Arabic`,
        kpis.every((entry) => typeof entry.labelAr === "string" && entry.labelAr.length > 0),
        JSON.stringify(kpis.map((e) => e.labelAr)),
      );
      // Four is what the strip lays out; past that it stops being a summary.
      ctx.check(`${label} keeps the strip to four figures`, kpis.length <= 4, `${kpis.length} kpis`);
    }
  });
}

async function headlineFiguresTieToTheLedger_R212(ctx: Ctx): Promise<void> {
  await ctx.scenario("R21.2 — every headline figure ties to the ledger beneath it", async () => {
    const tb = await ctx.req("GET", "/financial-reports/trial-balance");
    ctx.checkEq("trial balance: the مدين KPI is the مدين column total", kpi(tb.body, "debit"), ctx.n(tb.body?.grandTotals?.debit));
    ctx.checkEq("trial balance: the دائن KPI is the دائن column total", kpi(tb.body, "credit"), ctx.n(tb.body?.grandTotals?.credit));
    ctx.checkEq("trial balance: the KPI ties to the reconciliation banner", kpi(tb.body, "debit"), ctx.n(tb.body?.reconciliation?.reportTotal));
    // Exactly zero, not "within tolerance": this is the report's whole claim.
    ctx.check("trial balance: the الفرق KPI is exactly zero", kpi(tb.body, "difference") === 0, `${kpi(tb.body, "difference")}`);

    const bs = await ctx.req("GET", "/financial-reports/balance-sheet");
    ctx.checkEq("balance sheet: الأصول KPI ties to the A = L + E banner", kpi(bs.body, "totalAssets"), ctx.n(bs.body?.reconciliation?.reportTotal));
    ctx.checkEq("balance sheet: الالتزامات وحقوق الملكية KPI ties to the same banner", kpi(bs.body, "totalLiabilitiesEquity"), ctx.n(bs.body?.reconciliation?.referenceTotal));
    ctx.check("balance sheet: the الفرق KPI is exactly zero", kpi(bs.body, "difference") === 0, `${kpi(bs.body, "difference")}`);

    const is = await ctx.req("GET", "/financial-reports/income-statement?periodFrom=2026-01-01&periodTo=2026-12-31");
    ctx.checkEq("income statement: صافي الدخل KPI is the amount column total", kpi(is.body, "netIncome"), ctx.n(is.body?.grandTotals?.amount));
    ctx.checkEq(
      "income statement: الإيرادات − المصروفات = صافي الدخل",
      kpi(is.body, "revenue") - kpi(is.body, "expenses"),
      kpi(is.body, "netIncome"),
    );

    const cf = await ctx.req("GET", "/financial-reports/cash-flow?periodFrom=2026-01-01&periodTo=2026-12-31");
    ctx.checkEq(
      "cash flow: الرصيد الافتتاحي + صافي التغيّر = الرصيد الختامي",
      kpi(cf.body, "openingCash") + kpi(cf.body, "netChange"),
      kpi(cf.body, "closingCash"),
    );
    ctx.checkEq("cash flow: صافي التغيّر KPI is the flow column total", kpi(cf.body, "netChange"), ctx.n(cf.body?.grandTotals?.amount));

    const vat = await ctx.req("GET", "/financial-reports/vat-return?periodFrom=2026-01-01&periodTo=2026-12-31");
    ctx.checkEq("VAT: صافي الضريبة KPI is the tax column's net grand total", kpi(vat.body, "netPayable"), ctx.n(vat.body?.grandTotals?.tax));
    ctx.checkEq(
      "VAT: المخرجات − المدخلات = صافي الضريبة",
      kpi(vat.body, "outputTax") - kpi(vat.body, "inputTax"),
      kpi(vat.body, "netPayable"),
    );

    const gl = await ctx.req("GET", "/financial-reports/general-ledger?periodFrom=2026-01-01&periodTo=2026-12-31");
    ctx.checkEq("general ledger: the two KPI sides balance", kpi(gl.body, "debit"), kpi(gl.body, "credit"));
    ctx.check("general ledger: the strip counts every line, not a page", kpi(gl.body, "lineCount") === (gl.body?.rows ?? []).length, `${kpi(gl.body, "lineCount")} vs ${(gl.body?.rows ?? []).length}`);

    // The two by-item reports already reconcile to the GL; the KPI must be the
    // SAME figure, not a second opinion computed beside it.
    const byItem = await ctx.req("GET", "/reports/sales/by-item?dateFrom=2026-01-01&dateTo=2026-12-31");
    ctx.checkEq("sales by item: الإيرادات KPI is the reconciled report total", kpi(byItem.body, "revenue"), ctx.n(byItem.body?.reconciliation?.reportTotal));
    ctx.checkEq("sales by item: and therefore ties to what the GL posted", kpi(byItem.body, "revenue"), ctx.n(byItem.body?.reconciliation?.referenceTotal));

    const purchByItem = await ctx.req("GET", "/reports/purchases/by-item?dateFrom=2026-01-01&dateTo=2026-12-31");
    ctx.checkEq("purchases by item: التكلفة KPI ties to what the GL posted to inventory", kpi(purchByItem.body, "cost"), ctx.n(purchByItem.body?.reconciliation?.referenceTotal));

    const aging = await ctx.req("GET", "/reports/aging/customers");
    ctx.checkEq("aging: إجمالي المديونية KPI is the الإجمالي column total", kpi(aging.body, "total"), ctx.n(aging.body?.grandTotals?.total));
    ctx.checkEq(
      "aging: the 90+ KPI is the two oldest bucket totals",
      kpi(aging.body, "over90"),
      ctx.n(aging.body?.grandTotals?.d91to120) + ctx.n(aging.body?.grandTotals?.over120),
    );

    const byCustomer = await ctx.req("GET", "/reports/sales/by-customer?dateFrom=2026-01-01&dateTo=2026-12-31");
    ctx.checkEq("sales by customer: الإيرادات KPI is the column total", kpi(byCustomer.body, "total"), ctx.n(byCustomer.body?.grandTotals?.total));
    ctx.checkEq("sales by customer: المستحق KPI is the column total", kpi(byCustomer.body, "outstanding"), ctx.n(byCustomer.body?.grandTotals?.outstanding));
  });
}

async function aFilterMovesBothRowsAndKpi_R212(ctx: Ctx): Promise<void> {
  await ctx.scenario("R21.2 — narrowing a filter moves the rows AND the strip", async () => {
    const wide = await ctx.req("GET", "/reports/sales/by-period?dateFrom=2026-01-01&dateTo=2026-12-31");
    // The seeded sales all fall inside August, so the narrower window has to cut
    // INSIDE the month to be narrowing anything at all.
    const narrow = await ctx.req("GET", "/reports/sales/by-period?dateFrom=2026-08-01&dateTo=2026-08-15");
    const wideRows = (wide.body?.rows ?? []).length;
    const narrowRows = (narrow.body?.rows ?? []).length;
    ctx.check("sales by period: the wide range has something to narrow", wideRows > 0 && kpi(wide.body, "net") > 0, `${wideRows} rows, net ${kpi(wide.body, "net")}`);
    ctx.check("sales by period: narrowing the range drops rows", narrowRows < wideRows, `${narrowRows} vs ${wideRows}`);
    ctx.check(
      "sales by period: and the صافي المبيعات KPI drops with them",
      kpi(narrow.body, "net") < kpi(wide.body, "net"),
      `${kpi(narrow.body, "net")} vs ${kpi(wide.body, "net")}`,
    );
    // The strip is the narrowed set's own total, not the page's — it must equal
    // the narrowed grand total exactly.
    ctx.checkEq("sales by period: the narrowed KPI is the narrowed column total", kpi(narrow.body, "net"), ctx.n(narrow.body?.grandTotals?.net));

    const allSuppliers = await ctx.req("GET", "/reports/purchases/by-supplier?dateFrom=2000-01-01&dateTo=2099-12-31");
    const oneMonth = await ctx.req("GET", "/reports/purchases/by-supplier?dateFrom=2026-08-01&dateTo=2026-08-15");
    ctx.check(
      "purchases by supplier: a narrower period reports less spend",
      kpi(oneMonth.body, "total") < kpi(allSuppliers.body, "total"),
      `${kpi(oneMonth.body, "total")} vs ${kpi(allSuppliers.body, "total")}`,
    );
    ctx.checkEq("purchases by supplier: and the KPI still equals the column total", kpi(oneMonth.body, "total"), ctx.n(oneMonth.body?.grandTotals?.total));

    const allAges = await ctx.req("GET", "/reports/inventory/aging");
    const oneBucket = await ctx.req("GET", "/reports/inventory/aging?bucket=under30");
    ctx.check("inventory aging: the unfiltered report has stock to slice", kpi(allAges.body, "totalValue") > 0, `${kpi(allAges.body, "totalValue")}`);
    ctx.check(
      "inventory aging: filtering to one bucket cannot report more value than all buckets",
      kpi(oneBucket.body, "totalValue") <= kpi(allAges.body, "totalValue"),
      `${kpi(oneBucket.body, "totalValue")} vs ${kpi(allAges.body, "totalValue")}`,
    );
    ctx.checkEq("inventory aging: the filtered KPI is the filtered column total", kpi(oneBucket.body, "totalValue"), ctx.n(oneBucket.body?.grandTotals?.totalValue));
    ctx.check(
      "inventory aging: rows and the strip narrow together",
      (oneBucket.body?.rows ?? []).length <= (allAges.body?.rows ?? []).length,
      `${(oneBucket.body?.rows ?? []).length} vs ${(allAges.body?.rows ?? []).length}`,
    );

    const allMovements = await ctx.req("GET", "/reports/inventory/movement?dateFrom=2026-01-01&dateTo=2026-12-31");
    const inbound = await ctx.req("GET", "/reports/inventory/movement?dateFrom=2026-01-01&dateTo=2026-12-31&direction=IN");
    ctx.check("inventory movement: the unfiltered report moved stock both ways", kpi(allMovements.body, "inQty") > 0 && kpi(allMovements.body, "outQty") > 0, `in ${kpi(allMovements.body, "inQty")} out ${kpi(allMovements.body, "outQty")}`);
    ctx.checkEq("inventory movement: filtering to الوارد keeps the same inbound figure", kpi(inbound.body, "inQty"), kpi(allMovements.body, "inQty"));
    ctx.check("inventory movement: and drops the outbound one to zero", kpi(inbound.body, "outQty") === 0, `${kpi(inbound.body, "outQty")}`);
  });
}

async function drillDownAnswersFromTheSourceDocuments_A5(ctx: Ctx): Promise<void> {
  await ctx.scenario("A5 — a drill-down answers from the posted documents, not the loaded page", async () => {
    const bySupplier = await ctx.req("GET", "/reports/purchases/by-supplier?dateFrom=2000-01-01&dateTo=2099-12-31");
    const supplierRow = (bySupplier.body?.rows ?? [])[0];
    ctx.check("a supplier report row to drill into", Boolean(supplierRow?.supplierId), JSON.stringify(supplierRow).slice(0, 120));
    if (supplierRow?.supplierId) {
      const panel = await ctx.req("GET", `/reports/drill-down/supplier/${supplierRow.supplierId}`);
      ctx.check("supplier drill-down responds", panel.status === 200, `status ${panel.status}`);
      const billed = ctx.n((panel.body?.facts ?? []).find((f: any) => f.key === "billed")?.value);
      // Two independent paths to one number: the report aggregates invoices,
      // the panel re-reads them.
      ctx.checkEq("supplier drill-down's إجمالي المشتريات equals the report row's total", billed, ctx.n(supplierRow.total));
      ctx.check(
        "supplier drill-down lists its source invoices",
        (panel.body?.documents ?? []).length > 0 && (panel.body?.documents ?? []).every((d: any) => d.type === "PURCHASE_INVOICE" && typeof d.docNo === "string"),
        JSON.stringify(panel.body?.documents).slice(0, 200),
      );
      ctx.check(
        "supplier drill-down never returns more than the server's own cap",
        (panel.body?.documents ?? []).length <= 25 && ctx.n(panel.body?.documentCount) >= (panel.body?.documents ?? []).length,
        `${(panel.body?.documents ?? []).length} of ${panel.body?.documentCount}`,
      );
      if (ctx.n(panel.body?.documentCount) <= 25) {
        const summed = (panel.body?.documents ?? []).reduce((sum: number, d: any) => sum + ctx.n(d.amount), 0);
        ctx.checkEq("supplier drill-down's documents add up to the figure it reports", summed, billed);
      }
    }

    const byCustomer = await ctx.req("GET", "/reports/sales/by-customer?dateFrom=2000-01-01&dateTo=2099-12-31");
    const customerRow = (byCustomer.body?.rows ?? [])[0];
    if (customerRow?.customerId) {
      const panel = await ctx.req("GET", `/reports/drill-down/customer/${customerRow.customerId}`);
      ctx.check("customer drill-down responds", panel.status === 200, `status ${panel.status}`);
      const billed = ctx.n((panel.body?.facts ?? []).find((f: any) => f.key === "billed")?.value);
      ctx.checkEq("customer drill-down's إجمالي المفوتر equals the report row's revenue", billed, ctx.n(customerRow.total));
      ctx.check(
        "customer drill-down carries the invoice's real id, not its label",
        (panel.body?.documents ?? []).every((d: any) => typeof d.id === "string" && d.id.length > 0),
        JSON.stringify(panel.body?.documents).slice(0, 160),
      );
    }

    // The account panel and the trial balance are two readings of the same
    // postings; they must land on the same balance.
    const tb = await ctx.req("GET", "/financial-reports/trial-balance");
    const account = (tb.body?.rows ?? []).find((r: any) => ctx.n(r.debit) + ctx.n(r.credit) > 0);
    if (account?.accountId) {
      const panel = await ctx.req("GET", `/reports/drill-down/account/${account.accountId}`);
      ctx.check("account drill-down responds", panel.status === 200, `status ${panel.status}`);
      const balance = ctx.n((panel.body?.facts ?? []).find((f: any) => f.key === "balance")?.value);
      ctx.checkEq(
        "account drill-down's balance equals the trial balance's own row",
        balance,
        ctx.n(account.debit) - ctx.n(account.credit),
      );
      ctx.check(
        "account drill-down names the journal entries behind it",
        (panel.body?.documents ?? []).every((d: any) => d.type === "JOURNAL_ENTRY"),
        JSON.stringify(panel.body?.documents).slice(0, 160),
      );
    }

    const valuation = await ctx.req("GET", "/reports/inventory/valuation");
    const itemRow = (valuation.body?.rows ?? [])[0];
    if (itemRow?.itemId) {
      const panel = await ctx.req("GET", `/reports/drill-down/item/${itemRow.itemId}`);
      ctx.check("item drill-down responds", panel.status === 200, `status ${panel.status}`);
      const value = ctx.n((panel.body?.facts ?? []).find((f: any) => f.key === "value")?.value);
      ctx.checkEq("item drill-down's stock value equals the valuation report's row", value, ctx.n(itemRow.totalValue));
      ctx.check(
        "item drill-down lists the stock movements behind that value",
        (panel.body?.documents ?? []).every((d: any) => d.type === "STOCK_MOVEMENT" && d.amountFormat === "qty"),
        JSON.stringify(panel.body?.documents).slice(0, 160),
      );
    }

    const missing = await ctx.req("GET", "/reports/drill-down/customer/CUST-DOES-NOT-EXIST");
    ctx.check("an unknown entity is refused, not answered with an empty panel", missing.status === 404, `status ${missing.status}`);

    // The panel reaches a customer's invoices, so it is gated by the customer's
    // own permission, not by the report's.
    const unpermitted = await ctx.req(
      "GET",
      `/reports/drill-down/customer/${customerRow?.customerId ?? "CUST-DEMO-1"}`,
      undefined,
      { "x-permissions": "sales.invoice.view" },
    );
    ctx.check("the drill-down is gated by the entity's own permission", unpermitted.status === 403, `status ${unpermitted.status}`);
  });
}

async function glBalance(ctx: Ctx, accountId: string): Promise<number> {
  const res = await ctx.req("GET", `/gl/accounts/${accountId}/ledger`);
  return ctx.n(res.body?.balance?.balance);
}

/**
 * D192 — the seeded CHQ-DEMO-3 was applied against INV-DEMO-4, deposited and
 * returned by the bank. A bounce reverses the payment: the debt goes back on
 * 1105 and the invoice reopens, so the ladder, the customer's balance and the
 * control account describe one debt. Before, the bounce parked it on 1360 and
 * the ladder stood 1,750.00 above 1105.
 *
 * Runs against the seeded tenant before any module has written to it, so it
 * reads the demo as a user first sees it.
 */
export async function agingLaddersTieToTheirControlAccounts_D192(ctx: Ctx): Promise<void> {
  await ctx.scenario("D192 — both aging ladders tie to their control accounts on the seeded tenant, bounced cheque included", async () => {
    const customers = await ctx.req("GET", "/reports/aging/customers");
    const ar = await glBalance(ctx, "1105");
    ctx.check("aging customers: the reconciliation banner holds", customers.body?.reconciliation?.withinTolerance === true, JSON.stringify(customers.body?.reconciliation));
    ctx.checkEq("aging customers: the ladder total is the 1105 balance", ctx.n(customers.body?.grandTotals?.total), ar);

    const suppliers = await ctx.req("GET", "/reports/aging/suppliers");
    const ap = -(await glBalance(ctx, "2100"));
    ctx.check("aging suppliers: the reconciliation banner holds", suppliers.body?.reconciliation?.withinTolerance === true, JSON.stringify(suppliers.body?.reconciliation));
    ctx.checkEq("aging suppliers: the ladder total is the 2100 balance", ctx.n(suppliers.body?.grandTotals?.total), ap);

    ctx.checkEq("1360 holds nothing: no bounce parks a customer's debt off their own receivable", await glBalance(ctx, "1360"), 0);

    const cheque = await ctx.req("GET", "/cheques/CHQ-DEMO-3");
    ctx.check("CHQ-DEMO-3 is bounced and applies against nothing", cheque.body?.status === "bounced" && (cheque.body?.allocations ?? []).length === 0, JSON.stringify(cheque.body?.allocations));
    const history = ctx.rows((await ctx.req("GET", "/cheques/CHQ-DEMO-3/allocations")).body);
    ctx.check(
      "its allocation against INV-DEMO-4 was undone by the bounce, not deleted",
      history.length === 1 && history[0]?.invoiceId === "INV-DEMO-4" && history[0]?.status === "reversed",
      JSON.stringify(history),
    );
    const invoice = await ctx.req("GET", "/sales-invoices/INV-DEMO-4");
    ctx.checkEq("INV-DEMO-4 is open again for its whole value", ctx.n(invoice.body?.remainingBalance), ctx.n(invoice.body?.totals?.grandTotal));

    const agingRow = ctx.rows(customers.body).find((row: any) => row.customerId === "CUST-DEMO-1");
    const code = (await ctx.req("GET", "/customers/CUST-DEMO-1")).body?.code;
    const stats = await ctx.req("GET", `/customers/stats?q=${encodeURIComponent(String(code))}`);
    ctx.checkEq("CUST-DEMO-1: what the customers screen says they owe is their aging row", ctx.n(stats.body?.toCollect), ctx.n(agingRow?.total));
  });
}
