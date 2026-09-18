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
  "/reports/returns/fx-face-value",
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
  await everyCustomerOwesTheirAgingRow_D195(ctx);
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

/**
 * D195 — every customer's «المستحق» on the customers screen is their aging
 * row: one server computation, so an on-account receipt, a cheque or a return
 * cannot land in one and not the other. The row carries the opening balance
 * itself since D204, so the figure is the row, not opening balance plus row.
 */
export async function everyCustomerOwesTheirAgingRow_D195(ctx: Ctx): Promise<void> {
  await ctx.scenario("D195 — every customer's amount owed on the customers screen is their aging row", async () => {
    const aging = await ctx.req("GET", "/reports/aging/customers");
    const rowTotal = new Map(ctx.rows(aging.body).map((row: any) => [row.customerId, ctx.scaled(row.total)]));
    const customers = await ctx.allRows("/customers");
    ctx.check("the customers list carries the server's owed figure", customers.length > 0 && customers.every((c: any) => typeof c.owed === "string"), JSON.stringify(customers[0] ?? {}).slice(0, 200));
    const off = customers.filter((c: any) => ctx.scaled(c.owed) !== (rowTotal.get(c.id) ?? 0n));
    ctx.check("owed = the aging row, opening balance included, for every customer (D204)", off.length === 0, off.slice(0, 3).map((c: any) => `${c.id} owed ${c.owed} row ${rowTotal.get(c.id) ?? 0}`).join("; "));
  });
}

/**
 * D200, D201, D204, D205, D210, D211 — at the end of the run, after every module has
 * moved the tenant: both ladders tie to their control accounts to the
 * micro-unit, and for every customer and supplier the owed figure on their
 * screen, their aging row and the closing balance of their statement are one
 * number.
 */
export async function everyPartyTiesItsOwedLadderAndStatement(ctx: Ctx): Promise<void> {
  await ctx.scenario("every party — owed figure = aging row = statement closing, and both ladders tie exactly", async () => {
    for (const kind of ["customers", "suppliers"] as const) {
      const aging = await ctx.req("GET", `/reports/aging/${kind}`);
      ctx.check(
        `aging ${kind}: the ladder equals its control account to the micro-unit`,
        ctx.scaled(aging.body?.reconciliation?.reportTotal) === ctx.scaled(aging.body?.reconciliation?.referenceTotal),
        JSON.stringify(aging.body?.reconciliation),
      );
      const idOf = (row: any) => (kind === "customers" ? row.customerId : row.supplierId);
      const rowTotal = new Map(ctx.rows(aging.body).map((row: any) => [idOf(row), ctx.scaled(row.total)]));
      const parties = await ctx.allRows(`/${kind}`);
      const off: string[] = [];
      for (const party of parties) {
        const row = rowTotal.get(party.id) ?? 0n;
        const statement = (await ctx.req("GET", `/reports/statements/${kind}/${party.id}`)).body;
        const owed = ctx.scaled(party.owed);
        const closing = ctx.scaled(statement?.closing);
        if (owed !== row || closing !== row || ctx.scaled(statement?.agingTotal) !== row) {
          off.push(`${party.id} owed ${party.owed} row ${row} statement ${statement?.closing}`);
        }
      }
      ctx.check(`${kind}: every party's owed figure, aging row and statement closing agree`, parties.length > 0 && off.length === 0, off.slice(0, 4).join("; "));
    }
  });
}

/**
 * D220: a ladder run as of a past day ties to its control account as of that
 * day. Run last, when the tenant carries the most history — receipts,
 * returns, cheques bounced and vouchers reversed after many of these days.
 */
export async function laddersTieOnPastDays_D220(ctx: Ctx): Promise<void> {
  await ctx.scenario("D220 — both ladders tie to their control accounts as of every past day checked", async () => {
    const days = ["2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31"];
    for (let day = 15; day <= 31; day += 1) days.push(`2026-08-${String(day).padStart(2, "0")}`);
    days.push("2026-09-01", "2026-09-15");
    for (const kind of ["customers", "suppliers"] as const) {
      const off: string[] = [];
      for (const day of days) {
        const recon = (await ctx.req("GET", `/reports/aging/${kind}?asOfDate=${day}`)).body?.reconciliation;
        if (!recon || ctx.scaled(recon.reportTotal) !== ctx.scaled(recon.referenceTotal)) {
          off.push(`${day}: ladder ${recon?.reportTotal} control ${recon?.referenceTotal}`);
        }
      }
      ctx.check(`aging ${kind}: the ladder equals its control account to the micro-unit on each of ${days.length} past days`, off.length === 0, off.slice(0, 4).join("; "));
    }
  });
}

/**
 * D194, D195, D196 on the seeded tenant. A currency of this scenario's own
 * (CHF) keeps its open balance and its revaluation out of the USD/EUR trails
 * the seams module measures; the settings it needs are restored afterwards.
 */
export async function foreignInvoicesOnAccountReceiptsAndChequeVouchers_D194_D196(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, n } = ctx;
  const today = "2026-08-24";
  const monthEnd = "2026-08-31";
  const glBalanceOf = (accountId: string) => glBalance(ctx, accountId);
  const approveRate = async (id: string, rate: string, effectiveDate: string) => {
    await req("POST", "/exchange-rates", { id, currency: "CHF", rate, effectiveDate, rateType: "standard", source: "manual" });
    return req("POST", `/exchange-rates/${id}/approve`, {});
  };
  const tie = (body: any) => n(body?.reconciliation?.reportTotal) - n(body?.reconciliation?.referenceTotal);
  const item = (body: any) => n(((body?.reconciliation?.reconcilingItems ?? []) as any[]).find((i) => i.key === "fxRevaluation")?.amount ?? 0);

  await req("POST", "/items", { id: "SCN-D194-SVC", code: "SCN-D194-SVC", nameAr: "خدمة سيناريو الأعمار", type: "service", baseUnitCode: "PCS", trackInventory: false, taxRatePercent: 0, revenueAccountId: "4100" });

  await ctx.scenario("D194 — a foreign invoice on each side ages at its booked EGP value; revaluation is the ladders' one named reconciling item", async () => {
    const base = (await req("GET", "/settings")).body;
    const currencies: string[] = base?.secondaryCurrencies ?? [];
    const enabled = await req("PUT", "/settings", { ...base, multiCurrencyEnabled: true, secondaryCurrencies: [...currencies.filter((c) => c !== "CHF"), "CHF"] });
    check("multi-currency is on with CHF allowed", enabled.status === 200, `status ${enabled.status}`);
    check("a CHF booking rate of 60.00 is approved", (await approveRate("SCN-D194-CHF-20", "60.00", "2026-08-20")).body?.status === "approved");
    try {
      await req("POST", "/customers", { id: "SCN-D194-CUST", code: "SCN-D194-CUST", nameAr: "عميل بالفرنك", paymentTermsDays: 30, currency: "CHF", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
      await req("POST", "/suppliers", { id: "SCN-D194-SUPP", code: "SCN-D194-SUPP", nameAr: "مورد بالفرنك", currency: "CHF", openingBalance: "0" });
      const arBefore = await glBalanceOf("1105");
      const apBefore = -(await glBalanceOf("2100"));

      const sale = await req("POST", "/sales-invoices", {
        id: "SCN-D194-SI", date: today, dueDate: "2026-09-23", customerId: "SCN-D194-CUST", customerNameAr: "عميل بالفرنك",
        warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "CHF", arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "SCN-D194-SI-L1", itemId: "SCN-D194-SVC", itemNameAr: "خدمة بالفرنك", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
      });
      const saleConfirmed = await req("POST", "/sales-invoices/SCN-D194-SI/confirm", {});
      check("a CHF 100 sales invoice confirms", sale.status === 201 && saleConfirmed.status === 200, `${sale.status}/${saleConfirmed.status} ${JSON.stringify(saleConfirmed.body).slice(0, 200)}`);
      const bill = await req("POST", "/purchases/invoices", {
        id: "SCN-D194-PI", supplierId: "SCN-D194-SUPP", date: today, dueDate: "2026-09-23", warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "CHF",
        lines: [{ itemId: null, kind: "expense", description: "خدمة بالفرنك", qty: "1", unitCost: "50", taxRatePercent: 0 }],
      });
      const billConfirmed = await req("POST", "/purchases/invoices/SCN-D194-PI/confirm", {});
      check("a CHF 50 purchase invoice confirms", bill.status === 201 && billConfirmed.status === 200, `${bill.status}/${billConfirmed.status} ${JSON.stringify(billConfirmed.body).slice(0, 200)}`);
      checkEq("1105 takes the sale at its booked EGP value, 100 × 60.00", (await glBalanceOf("1105")) - arBefore, 6000);
      checkEq("2100 takes the bill at its booked EGP value, 50 × 60.00", -(await glBalanceOf("2100")) - apBefore, 3000);

      const customers = await req("GET", "/reports/aging/customers");
      const suppliers = await req("GET", "/reports/aging/suppliers");
      checkEq("the customer ladder ages the CHF invoice at 6,000.00, not at its face 100", n(ctx.rows(customers.body).find((r: any) => r.customerId === "SCN-D194-CUST")?.total), 6000);
      checkEq("the supplier ladder ages the CHF bill at 3,000.00, not at its face 50", n(ctx.rows(suppliers.body).find((r: any) => r.supplierId === "SCN-D194-SUPP")?.total), 3000);
      check("the customer ladder still ties to 1105", customers.body?.reconciliation?.withinTolerance === true, JSON.stringify(customers.body?.reconciliation));
      check("the supplier ladder still ties to 2100", suppliers.body?.reconciliation?.withinTolerance === true, JSON.stringify(suppliers.body?.reconciliation));

      const agingAt = (side: string) => req("GET", `/reports/aging/${side}?asOfDate=${monthEnd}`);
      const customerTieBefore = tie((await agingAt("customers")).body);
      const supplierTieBefore = tie((await agingAt("suppliers")).body);
      check("a CHF closing rate of 62.50 is approved", (await approveRate("SCN-D194-CHF-31", "62.50", monthEnd)).body?.status === "approved");
      const revalued = await req("POST", "/revaluation/post", { date: monthEnd, currencies: ["CHF"], autoReverse: true });
      check("the month-end CHF revaluation posts, with its next-day reversal", revalued.status === 201 && Boolean(revalued.body?.reversalId), `status ${revalued.status} ${JSON.stringify(revalued.body).slice(0, 200)}`);
      const customersAtMonthEnd = (await agingAt("customers")).body;
      const suppliersAtMonthEnd = (await agingAt("suppliers")).body;
      checkEq("on the revaluation date the customer ladder names the 250.00 restatement of 1105 (100 × 2.50)", item(customersAtMonthEnd), 250);
      checkEq("and the supplier ladder the 125.00 restatement of 2100 (50 × 2.50)", item(suppliersAtMonthEnd), 125);
      checkEq("the customer ladder's tie is exactly what it was before the revaluation", tie(customersAtMonthEnd), customerTieBefore);
      checkEq("and so is the supplier ladder's", tie(suppliersAtMonthEnd), supplierTieBefore);
      const customersNow = (await req("GET", "/reports/aging/customers")).body;
      check("once the reversal has posted there is nothing left to reconcile", item(customersNow) === 0 && customersNow?.reconciliation?.withinTolerance === true, JSON.stringify(customersNow?.reconciliation));
    } finally {
      const restored = await req("PUT", "/settings", { ...(await req("GET", "/settings")).body, multiCurrencyEnabled: base?.multiCurrencyEnabled, secondaryCurrencies: currencies });
      check("the currency settings are restored", restored.status === 200, `status ${restored.status}`);
    }
  });

  await ctx.scenario("D195 — an on-account receipt moves the customers screen and the aging row together", async () => {
    await req("POST", "/customers", { id: "SCN-D195-CUST", code: "SCN-D195-CUST", nameAr: "عميل الدفعة غير المخصصة", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
    await req("POST", "/sales-invoices", {
      id: "SCN-D195-SI", date: today, dueDate: "2026-09-23", customerId: "SCN-D195-CUST", customerNameAr: "عميل الدفعة غير المخصصة",
      warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "SCN-D195-SI-L1", itemId: "SCN-D194-SVC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "1000", taxRatePercent: 0, revenueAccountId: "4100" }],
    });
    await req("POST", "/sales-invoices/SCN-D195-SI/confirm", {});
    const cash = (await req("GET", "/treasury-accounts/TR-DEMO-CASH")).body;
    await req("POST", "/vouchers", {
      id: "SCN-D195-V", date: today, voucherType: "customer_collection", amount: "100", branchId: "BR-MAIN", paymentMethod: "cash",
      treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: cash?.glAccountId, counterpartyGlAccountId: "1105", customerId: "SCN-D195-CUST",
    });
    const confirmed = await req("POST", "/vouchers/SCN-D195-V/confirm", {});
    check("a 100.00 collection nobody allocates confirms", confirmed.status === 200, `status ${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 200)}`);
    const row = ctx.rows((await req("GET", "/reports/aging/customers")).body).find((r: any) => r.customerId === "SCN-D195-CUST");
    const customer = (await req("GET", "/customers/SCN-D195-CUST")).body;
    checkEq("the aging row nets the on-account receipt: 1,000.00 − 100.00", n(row?.total), 900);
    checkEq("and the customers screen says the same", n(customer?.owed), 900);
    checkEq("so does the KPI strip", n((await req("GET", "/customers/stats?q=SCN-D195-CUST")).body?.toCollect), 900);
  });

  await ctx.scenario("D196 — a «شيك» receipt voucher raises its cheque in the real app, credits AR once, and its bounce reverses it", async () => {
    await req("POST", "/customers", { id: "SCN-D196-CUST", code: "SCN-D196-CUST", nameAr: "عميل الشيك", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
    await req("POST", "/sales-invoices", {
      id: "SCN-D196-SI", date: today, dueDate: "2026-09-23", customerId: "SCN-D196-CUST", customerNameAr: "عميل الشيك",
      warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "SCN-D196-SI-L1", itemId: "SCN-D194-SVC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "1000", taxRatePercent: 0, revenueAccountId: "4100" }],
    });
    await req("POST", "/sales-invoices/SCN-D196-SI/confirm", {});
    const bank = (await req("GET", "/treasury-accounts/TR-DEMO-BANK")).body;
    const treasuryGl = String(bank?.glAccountId);
    const before = { ar: await glBalanceOf("1105"), cheques: await glBalanceOf("1320"), bank: await glBalanceOf(treasuryGl), invariants: await ctx.invariants() };

    const created = await req("POST", "/vouchers", {
      id: "SCN-D196-V", date: today, voucherType: "customer_collection", amount: "400", branchId: "BR-MAIN", paymentMethod: "cheque", referenceNo: "SCN-D196-0001",
      treasuryAccountId: "TR-DEMO-BANK", treasuryGlAccountId: treasuryGl, counterpartyGlAccountId: "1105", customerId: "SCN-D196-CUST",
    });
    const confirmed = await req("POST", "/vouchers/SCN-D196-V/confirm", {});
    check("a «شيك» collection of 400.00 creates and confirms", created.status === 201 && confirmed.status === 200, `${created.status}/${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 200)}`);
    const cheque = (await req("GET", "/cheques/SCN-D196-V")).body;
    check(
      "the cheque register holds it: incoming, pending, the customer's, numbered as typed",
      cheque?.direction === "incoming" && cheque?.status === "pending" && cheque?.partyId === "SCN-D196-CUST" && cheque?.chequeNumber === "SCN-D196-0001",
      JSON.stringify(cheque).slice(0, 240),
    );
    checkEq("the cheque is for the voucher's 400.00", n(cheque?.amount), 400);
    checkEq("1105 is credited ONCE — by the voucher, not again by the cheque", (await glBalanceOf("1105")) - before.ar, -400);
    checkEq("the amount waits in cheques under collection", (await glBalanceOf("1320")) - before.cheques, 400);
    checkEq("and the bank holds nothing until the cheque clears", (await glBalanceOf(treasuryGl)) - before.bank, 0);
    const after = await ctx.invariants();
    checkEq("the AR sub-ledger still reconciles", after.ar, before.invariants.ar);
    check("the customer ladder still ties to 1105", (await req("GET", "/reports/aging/customers")).body?.reconciliation?.withinTolerance === true);

    await req("POST", "/cheques/SCN-D196-V/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" });
    const bounced = await req("POST", "/cheques/SCN-D196-V/bounce", { date: today });
    check("the bank returns the cheque", bounced.status === 200 && bounced.body?.status === "bounced", `status ${bounced.status} ${JSON.stringify(bounced.body).slice(0, 200)}`);
    check("the bounce reverses the voucher that raised it", (await req("GET", "/vouchers/SCN-D196-V")).body?.status === "reversed");
    checkEq("the debt is back on 1105", await glBalanceOf("1105"), before.ar);
    checkEq("1320 is empty again", await glBalanceOf("1320"), before.cheques);
    checkEq("and the bank never moved", await glBalanceOf(treasuryGl), before.bank);
    const settled = await ctx.invariants();
    checkEq("the AR sub-ledger still reconciles after the bounce", settled.ar, before.invariants.ar);
    const row = ctx.rows((await req("GET", "/reports/aging/customers")).body).find((r: any) => r.customerId === "SCN-D196-CUST");
    checkEq("the customer owes the whole invoice again on the ladder", n(row?.total), 1000);
  });
}

/**
 * D201, D202, D203 on the seeded tenant: a CHF invoice on each side is
 * settled in base, reported in base, and partly returned at its own rate.
 * CHF is this module's own currency (see D194); the settings are restored.
 */
export async function foreignSettlementReportsAndReturns_D201_D203(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, n } = ctx;
  const today = "2026-08-24";
  const glBalanceOf = (accountId: string) => glBalance(ctx, accountId);

  await ctx.scenario("D201–D203 — a CHF invoice on each side is settled in base, reported in base and returned at its own rate", async () => {
    const base = (await req("GET", "/settings")).body;
    const currencies: string[] = base?.secondaryCurrencies ?? [];
    const enabled = await req("PUT", "/settings", { ...base, multiCurrencyEnabled: true, secondaryCurrencies: [...currencies.filter((c) => c !== "CHF"), "CHF"] });
    check("multi-currency is on with CHF allowed", enabled.status === 200, `status ${enabled.status}`);
    await req("POST", "/exchange-rates", { id: "SCN-D202-CHF-22", currency: "CHF", rate: "60.00", effectiveDate: "2026-08-22", rateType: "standard", source: "manual" });
    check("a CHF rate of 60.00 is approved for the 22nd", (await req("POST", "/exchange-rates/SCN-D202-CHF-22/approve", {})).body?.status === "approved");
    try {
      await req("POST", "/items", { id: "SCN-D202-SVC", code: "SCN-D202-SVC", nameAr: "خدمة سيناريو التسوية", type: "service", baseUnitCode: "PCS", trackInventory: false, taxRatePercent: 0, revenueAccountId: "4100" });
      await req("POST", "/items", { id: "SCN-D203-STK", code: "SCN-D203-STK", nameAr: "صنف مرتجع بالفرنك", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" });
      await req("POST", "/customers", { id: "SCN-D202-CUST", code: "SCN-D202-CUST", nameAr: "عميل التسوية بالفرنك", paymentTermsDays: 30, currency: "CHF", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
      await req("POST", "/suppliers", { id: "SCN-D203-SUPP", code: "SCN-D203-SUPP", nameAr: "مورد المرتجع بالفرنك", currency: "CHF", openingBalance: "0" });
      const before = { ar: await glBalanceOf("1105"), ap: -(await glBalanceOf("2100")), invariants: await ctx.invariants() };

      await req("POST", "/sales-invoices", {
        id: "SCN-D202-SI", date: today, dueDate: "2026-09-23", customerId: "SCN-D202-CUST", customerNameAr: "عميل التسوية بالفرنك",
        warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "CHF", arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "SCN-D202-SI-L1", itemId: "SCN-D202-SVC", itemNameAr: "خدمة بالفرنك", isStock: false, qty: "2", unitPrice: "50", taxRatePercent: 0, revenueAccountId: "4100" }],
      });
      const sale = await req("POST", "/sales-invoices/SCN-D202-SI/confirm", {});
      check("a CHF 100 sales invoice confirms at 60.00", sale.status === 200, `status ${sale.status} ${JSON.stringify(sale.body).slice(0, 200)}`);
      checkEq("1105 takes it at 6,000.00", (await glBalanceOf("1105")) - before.ar, 6000);

      const collected = await req("POST", "/sales-invoices/SCN-D202-SI/payments", { amount: "1000", treasuryAccountId: "TR-DEMO-CASH", date: today });
      check("EGP 1,000 is collected against it", collected.status === 200, `status ${collected.status} ${JSON.stringify(collected.body).slice(0, 200)}`);
      let invoice = (await req("GET", "/sales-invoices/SCN-D202-SI")).body;
      check("D202: EGP 1,000 against a CHF 100 invoice worth 6,000.00 leaves it «مدفوع جزئياً», not «مدفوع»", invoice?.status === "partially_paid", String(invoice?.status));
      checkEq("its base total is stated beside the settlement", n(invoice?.baseGrandTotal), 6000);
      checkEq("its remaining balance is the base total less what was allocated", n(invoice?.remainingBalance), 5000);
      checkEq("1105 holds the same 5,000.00", (await glBalanceOf("1105")) - before.ar, 5000);

      const byCustomer = (await req("GET", `/reports/sales/by-customer?dateFrom=${today}&dateTo=${today}`)).body;
      const row = ctx.rows(byCustomer).find((r: any) => r.customerId === "SCN-D202-CUST");
      checkEq("D201: sales by customer counts the invoice at its 6,000.00 base value, not its face 100", n(row?.total), 6000);
      checkEq("and its outstanding at the base 5,000.00", n(row?.outstanding), 5000);
      const byPeriod = ctx.rows((await req("GET", `/reports/sales/by-period?dateFrom=${today}&dateTo=${today}&groupBy=day`)).body);
      check("D201: sales by period includes the invoice at base", byPeriod.some((r: any) => n(r.net) >= 6000), JSON.stringify(byPeriod).slice(0, 200));

      const drafted = await req("POST", "/sales-returns/from-invoice", {
        id: "SCN-D203-SR", date: today, memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: "SCN-D202-SI", reason: "OTHER", requested: [{ itemId: "SCN-D202-SVC", qty: "1" }],
      });
      const returned = await req("POST", "/sales-returns/SCN-D203-SR/confirm", {});
      check("one of the two CHF 50 units comes back", drafted.status === 201 && returned.status === 200, `${drafted.status}/${returned.status} ${JSON.stringify(returned.body).slice(0, 200)}`);
      checkEq("D203: the return credits 1105 with CHF 50 × 60.00 = 3,000.00, not 50", (await glBalanceOf("1105")) - before.ar, 2000);
      checkEq("the return states that base credit as its total", n((await req("GET", "/sales-returns/SCN-D203-SR")).body?.grandTotal), 3000);
      checkEq("and it owes the customer 3,000.00 back", n((await req("GET", "/sales-returns/SCN-D203-SR")).body?.refundDue), 3000);
      invoice = (await req("GET", "/sales-invoices/SCN-D202-SI")).body;
      checkEq("the invoice now owes 6,000.00 − 1,000.00 − 3,000.00", n(invoice?.remainingBalance), 2000);
      const byCustomerAfterReturn = ctx.rows((await req("GET", `/reports/sales/by-customer?dateFrom=${today}&dateTo=${today}`)).body).find((r: any) => r.customerId === "SCN-D202-CUST");
      checkEq("D219: sales by customer's outstanding nets the return too", n(byCustomerAfterReturn?.outstanding), 2000);
      const drill = (await req("GET", "/reports/drill-down/customer/SCN-D202-CUST")).body;
      checkEq("D219: and so does the customer drill-down", n(drill?.facts?.find((f: any) => f.key === "outstanding")?.value), 2000);
      const overCollect = await req("POST", "/sales-invoices/SCN-D202-SI/payments", { amount: "2000.01", treasuryAccountId: "TR-DEMO-CASH", date: today });
      checkEq("D219: a collection beyond what the return left owing is refused", overCollect.status, 422);
      checkEq("the /reconciliation AR row is exactly as tied as before", (await ctx.invariants()).ar, before.invariants.ar);

      await req("POST", "/purchases/invoices", {
        id: "SCN-D203-PI", supplierId: "SCN-D203-SUPP", date: today, dueDate: "2026-09-23", warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "CHF",
        lines: [{ itemId: "SCN-D203-STK", kind: "inventory", description: "صنف بالفرنك", qty: "10", unitCost: "5", taxRatePercent: 14 }],
      });
      const bill = await req("POST", "/purchases/invoices/SCN-D203-PI/confirm", {});
      check("a CHF 57 purchase invoice confirms at 60.00", bill.status === 200, `status ${bill.status} ${JSON.stringify(bill.body).slice(0, 200)}`);
      checkEq("2100 takes it at 3,420.00", -(await glBalanceOf("2100")) - before.ap, 3420);
      const paid = await req("POST", "/purchases/invoices/SCN-D203-PI/payments", { amount: "420", treasuryAccountId: "TR-DEMO-CASH", date: today });
      check("EGP 420 is paid against it", paid.status === 200, `status ${paid.status} ${JSON.stringify(paid.body).slice(0, 200)}`);
      const pi = (await req("GET", "/purchases/invoices/SCN-D203-PI")).body;
      checkEq("D202: its base total is stated beside the settlement", n(pi?.baseTotal), 3420);
      checkEq("and its remaining balance is base total − paid", n(pi?.remainingBalance), 3000);

      const number = String(pi?.number ?? "");
      const prCreated = await req("POST", "/purchase-returns", {
        id: "SCN-D203-PR", date: today, memo: "",
        lines: [{ itemId: "SCN-D203-STK", warehouseId: "WH-MAIN", supplierId: "SCN-D203-SUPP", sourceInvoiceId: "SCN-D203-PI", sourceInvoiceNumber: number, reason: "DEFECTIVE",
          availableQty: "10", qty: "2", unitCost: "5", taxAmount: "1.40", taxRatePercent: 14, fxRate: "1", currency: "EGP" }],
      });
      const prConfirmed = await req("POST", "/purchase-returns/SCN-D203-PR/confirm", {});
      check("two units go back to the supplier", prCreated.status === 201 && prConfirmed.status === 200, `${prCreated.status}/${prConfirmed.status} ${JSON.stringify(prConfirmed.body).slice(0, 200)}`);
      checkEq("D203: the return debits 2100 with CHF 11.40 × 60.00 = 684.00, whatever rate the caller sent", -(await glBalanceOf("2100")) - before.ap, 3420 - 420 - 684);
      const piAfterReturn = (await req("GET", "/purchases/invoices/SCN-D203-PI")).body;
      checkEq("D216: the bill's remaining balance nets its return, 3,420.00 − 420.00 − 684.00", n(piAfterReturn?.remainingBalance), 3420 - 420 - 684);
      checkEq("D216: and names the 684.00 it returned", n(piAfterReturn?.returnedCredit), 684);
      const supplierRow = ctx.rows((await req("GET", "/reports/aging/suppliers")).body).find((r: any) => r.supplierId === "SCN-D203-SUPP");
      checkEq("D216: which is the supplier's row on the ladder", n(supplierRow?.total), n(piAfterReturn?.remainingBalance));
      const bySupplier = ctx.rows((await req("GET", `/reports/purchases/by-supplier?dateFrom=${today}&dateTo=${today}`)).body).find((r: any) => r.supplierId === "SCN-D203-SUPP");
      checkEq("D217: purchases by supplier's «المستحق» is that same figure, not the bill's full total", n(bySupplier?.outstanding), n(supplierRow?.total));
      const after = await ctx.invariants();
      checkEq("the /reconciliation AP row is exactly as tied as before", after.ap, before.invariants.ap);
      checkEq("and so is inventory", after.inventory, before.invariants.inventory);
      check("the supplier ladder still ties to 2100", (await req("GET", "/reports/aging/suppliers")).body?.reconciliation?.withinTolerance === true);
      check("the customer ladder still ties to 1105", (await req("GET", "/reports/aging/customers")).body?.reconciliation?.withinTolerance === true);
    } finally {
      const restored = await req("PUT", "/settings", { ...(await req("GET", "/settings")).body, multiCurrencyEnabled: base?.multiCurrencyEnabled, secondaryCurrencies: currencies });
      check("the currency settings are restored", restored.status === 200, `status ${restored.status}`);
    }
  });
}

/**
 * D213, D214, D215, D221, D222 on the seeded tenant, in CAD — this scenario's
 * own currency, so its open positions and revaluation stay out of every other
 * module's. CAD is 35.20 on the 23rd and 36.00 from the 26th; the settings are
 * restored afterwards.
 */
export async function foreignRatesSettleAndReturnInputs_D213_D222(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, n } = ctx;
  const booked = "2026-08-24";
  const settled = "2026-08-27";
  const glBalanceOf = (accountId: string) => glBalance(ctx, accountId);
  const exact = async () => ctx.invariants();

  await ctx.scenario("D213–D222 — a CAD bill balances line by line, raw returns read their invoice, and settling at 36.00 what was booked at 35.20 realises the difference", async () => {
    const base = (await req("GET", "/settings")).body;
    const currencies: string[] = base?.secondaryCurrencies ?? [];
    const enabled = await req("PUT", "/settings", { ...base, multiCurrencyEnabled: true, secondaryCurrencies: [...currencies.filter((c) => c !== "CAD"), "CAD"] });
    check("multi-currency is on with CAD allowed", enabled.status === 200, `status ${enabled.status}`);
    for (const [id, rate, date] of [["SCN-D221-CAD-23", "35.20", "2026-08-23"], ["SCN-D221-CAD-26", "36.00", "2026-08-26"]] as const) {
      await req("POST", "/exchange-rates", { id, currency: "CAD", rate, effectiveDate: date, rateType: "standard", source: "manual" });
      check(`a CAD rate of ${rate} is approved from ${date}`, (await req("POST", `/exchange-rates/${id}/approve`, {})).body?.status === "approved");
    }
    try {
      for (const id of ["SCN-D213-STK1", "SCN-D213-STK2", "SCN-D213-STK3"]) {
        await req("POST", "/items", { id, code: id, nameAr: `صنف بالدولار الكندي ${id.slice(-1)}`, type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" });
      }
      await req("POST", "/items", { id: "SCN-D221-SVC", code: "SCN-D221-SVC", nameAr: "خدمة بالدولار الكندي", type: "service", baseUnitCode: "PCS", trackInventory: false, taxRatePercent: 0, revenueAccountId: "4100" });
      await req("POST", "/suppliers", { id: "SCN-D213-SUPP", code: "SCN-D213-SUPP", nameAr: "مورد بالدولار الكندي", currency: "CAD", openingBalance: "0" });
      await req("POST", "/customers", { id: "SCN-D221-CUST", code: "SCN-D221-CUST", nameAr: "عميل بالدولار الكندي", paymentTermsDays: 30, currency: "CAD", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
      const start = { ar: await glBalanceOf("1105"), ap: await glBalanceOf("2100"), gain: await glBalanceOf("4900"), loss: await glBalanceOf("5900"), invariants: await exact() };

      // D213 — three lines at 0.333333 convert to one micro-unit more, line by
      // line, than their sum converted once.
      const bill = await req("POST", "/purchases/invoices", {
        id: "SCN-D213-PI", supplierId: "SCN-D213-SUPP", date: booked, dueDate: "2026-09-23", warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "CAD", projectId: "PRJ-DEMO-1",
        lines: [
          { itemId: "SCN-D213-STK1", kind: "inventory", description: "صنف 1", qty: "3", unitCost: "0.333333", taxRatePercent: 14, costCategory: "materials" },
          { itemId: "SCN-D213-STK2", kind: "inventory", description: "صنف 2", qty: "1", unitCost: "0.333333", taxRatePercent: 14, costCategory: "materials" },
          { itemId: null, kind: "freight", description: "شحن", qty: "1", unitCost: "0.333333", taxRatePercent: 0 },
          { itemId: "SCN-D213-STK3", kind: "inventory", description: "صنف 3", qty: "10", unitCost: "20", taxRatePercent: 14, costCategory: "materials" },
        ],
      });
      const billConfirmed = await req("POST", "/purchases/invoices/SCN-D213-PI/confirm", {});
      check("D213: a four-line CAD bill whose lines convert a micro-unit apart from their sums is accepted and posts", bill.status === 201 && billConfirmed.status === 200, `${bill.status}/${billConfirmed.status} ${JSON.stringify(billConfirmed.body).slice(0, 240)}`);
      const pi = (await req("GET", "/purchases/invoices/SCN-D213-PI")).body;
      check("D213: its base total is the sum of its lines converted one by one — 8,090.837287, not the 8,090.837286 its summed kinds convert to", ctx.scaled(pi?.baseTotal) === 8090837287n, `baseTotal ${pi?.baseTotal}`);
      check("D213: and 2100 is credited with exactly that", ctx.scaled(-((await glBalanceOf("2100")) - start.ap)) === 8090837287n, `2100 moved ${(await glBalanceOf("2100")) - start.ap}`);
      let now = await exact();
      check("D213: the AP sub-ledger still ties to the micro-unit", now.exact.ap === start.invariants.exact.ap, `ap ${now.ap}`);
      check("D213: and the stock the bill received is worth exactly what it debited to 1200", now.exact.inventory === start.invariants.exact.inventory, `inventory ${now.inventory}`);

      // D214 / D215 — a raw return states its own cost, VAT, rate and no project.
      const mismatch = await req("POST", "/purchase-returns", {
        id: "SCN-D214-PR-X", date: booked, memo: "",
        lines: [{ itemId: "SCN-D213-STK3", warehouseId: "WH-MAIN", supplierId: "SUPP-DEMO-1", sourceInvoiceId: "SCN-D213-PI", sourceInvoiceNumber: null, reason: "DEFECTIVE", availableQty: "10", qty: "1", unitCost: "20", taxAmount: "2.80" }],
      });
      check("D214: a purchase return naming another supplier than its invoice's is refused", mismatch.status === 422 && mismatch.body?.error === "RETURN_SUPPLIER_MISMATCH", `${mismatch.status} ${JSON.stringify(mismatch.body).slice(0, 200)}`);
      const pr = await req("POST", "/purchase-returns", {
        id: "SCN-D214-PR", date: booked, memo: "",
        lines: [{ itemId: "SCN-D213-STK3", warehouseId: "WH-MAIN", supplierId: "SCN-D213-SUPP", sourceInvoiceId: "SCN-D213-PI", sourceInvoiceNumber: null, reason: "DEFECTIVE", availableQty: "10", qty: "1", unitCost: "999", taxAmount: "999", taxRatePercent: 50 }],
      });
      const prLine = pr.body?.lines?.[0];
      check("D214: the raw purchase return takes the invoice's cost, VAT share and rate, not the caller's", pr.status === 201 && n(prLine?.unitCost) === 20 && n(prLine?.taxAmount) === 2.8 && prLine?.taxRatePercent === 14, JSON.stringify(prLine).slice(0, 240));
      check("D215: and it inherits the invoice's project and cost category", prLine?.projectId === "PRJ-DEMO-1" && prLine?.costCategory === "materials", JSON.stringify(prLine).slice(0, 240));
      const prConfirmed = await req("POST", "/purchase-returns/SCN-D214-PR/confirm", {});
      check("the return confirms", prConfirmed.status === 200, `status ${prConfirmed.status} ${JSON.stringify(prConfirmed.body).slice(0, 200)}`);
      checkEq("D214: it debits 2100 with CAD 22.80 × 35.20 = 802.56", (await glBalanceOf("2100")) + n(pi?.baseTotal) - start.ap, 802.56);

      await req("POST", "/sales-invoices", {
        id: "SCN-D214-SI", date: booked, dueDate: "2026-09-23", customerId: "SCN-D221-CUST", customerNameAr: "عميل بالدولار الكندي",
        warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "CAD", arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "SCN-D214-SI-L1", itemId: "SCN-D221-SVC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "10", taxRatePercent: 0, revenueAccountId: "4100" }],
      });
      await req("POST", "/sales-invoices/SCN-D214-SI/confirm", {});
      const sr = await req("POST", "/sales-returns", {
        id: "SCN-D214-SR", date: booked, memo: "",
        lines: [{ itemId: "SCN-D221-SVC", warehouseId: "WH-MAIN", customerId: "SCN-D221-CUST", sourceInvoiceId: "SCN-D214-SI", sourceInvoiceNumber: null, reason: "OTHER", availableQty: "1", qty: "1", unitPrice: "999", unitCost: "0", taxAmount: "999" }],
      });
      check("D214: the raw sales return takes the invoice's price and VAT, not the caller's", sr.status === 201 && n(sr.body?.lines?.[0]?.unitPrice) === 10 && n(sr.body?.lines?.[0]?.taxAmount) === 0, JSON.stringify(sr.body?.lines?.[0]).slice(0, 240));
      checkEq("and credits CAD 10 at 35.20", n(sr.body?.grandTotal), 352);
      check("the sales return confirms", (await req("POST", "/sales-returns/SCN-D214-SR/confirm", {})).status === 200);
      now = await exact();
      check("AR and AP still tie to the micro-unit after both raw returns", now.exact.ar === start.invariants.exact.ar && now.exact.ap === start.invariants.exact.ap, `ar ${now.ar} ap ${now.ap}`);

      // D221 — a customer pays CAD 100 booked at 35.20 with EGP at 36.00.
      await req("POST", "/sales-invoices", {
        id: "SCN-D221-SI", date: booked, dueDate: "2026-09-23", customerId: "SCN-D221-CUST", customerNameAr: "عميل بالدولار الكندي",
        warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "CAD", arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "SCN-D221-SI-L1", itemId: "SCN-D221-SVC", itemNameAr: "خدمة", isStock: false, qty: "2", unitPrice: "50", taxRatePercent: 0, revenueAccountId: "4100" }],
      });
      check("a CAD 100 sales invoice confirms at 35.20", (await req("POST", "/sales-invoices/SCN-D221-SI/confirm", {})).status === 200);
      const ar = await glBalanceOf("1105");
      const over = await req("POST", "/sales-invoices/SCN-D221-SI/payments", { amount: "3600.01", treasuryAccountId: "TR-DEMO-CASH", date: settled });
      check("D221: EGP 3,600.01 at 36.00 is more than CAD 100 and is refused", over.status === 422, `status ${over.status}`);
      const paid = await req("POST", "/sales-invoices/SCN-D221-SI/payments", { amount: "3600", treasuryAccountId: "TR-DEMO-CASH", date: settled });
      check("D221: EGP 3,600.00 at 36.00 is collected against it", paid.status === 200, `status ${paid.status} ${JSON.stringify(paid.body).slice(0, 200)}`);
      const si = (await req("GET", "/sales-invoices/SCN-D221-SI")).body;
      check("D221: it settles the invoice in full, which reads «مدفوع»", si?.status === "paid" && n(si?.remainingBalance) === 0, `${si?.status} ${si?.remainingBalance}`);
      checkEq("D221: 1105 is relieved of the 3,520.00 it was booked at and no more — nothing is left on the customer", (await glBalanceOf("1105")) - ar, -3520);
      checkEq("D221: the 80.00 difference is a realised gain on 4900", (await glBalanceOf("4900")) - start.gain, -80);
      now = await exact();
      check("D221: the AR sub-ledger still ties to the micro-unit", now.exact.ar === start.invariants.exact.ar, `ar ${now.ar}`);
      const statement = (await req("GET", "/reports/statements/customers/SCN-D221-CUST")).body;
      check("D221: the customer's statement shows the realised difference and closes on their ladder row", statement?.closing === statement?.agingTotal && (statement?.lines ?? []).some((line: any) => line.kind === "fx_difference" && n(line.increase) === 80), JSON.stringify({ closing: statement?.closing, aging: statement?.agingTotal }));
      const revaluation = (await req("POST", "/revaluation/preview", { date: "2026-08-31", currencies: ["CAD"] })).body;
      const arDetail = ((revaluation?.details ?? []) as any[]).find((detail) => detail.accountId === "1105");
      check("D221: month-end revaluation finds nothing left open on 1105 in CAD to restate again", !arDetail || n(arDetail.delta) === 0 || n(arDetail.foreignAmount) !== 0, JSON.stringify(arDetail ?? null));

      // D221 — the supplier is paid by a «شيك» at 36.00 against the bill at 35.20.
      const bankGl = String((await req("GET", "/treasury-accounts/TR-DEMO-BANK")).body?.glAccountId);
      const voucher = await req("POST", "/vouchers", {
        id: "SCN-D221-V", date: settled, voucherType: "supplier_payment", amount: "3600", branchId: "BR-MAIN", paymentMethod: "cheque", referenceNo: "SCN-D221-0001",
        treasuryAccountId: "TR-DEMO-BANK", treasuryGlAccountId: bankGl, counterpartyGlAccountId: "2100", supplierId: "SCN-D213-SUPP",
      });
      const voucherConfirmed = await req("POST", "/vouchers/SCN-D221-V/confirm", {});
      check("an EGP 3,600.00 «شيك» payment to the CAD supplier posts and raises its cheque", voucher.status === 201 && voucherConfirmed.status === 200, `${voucher.status}/${voucherConfirmed.status} ${JSON.stringify(voucherConfirmed.body).slice(0, 200)}`);
      const apBefore = await glBalanceOf("2100");
      const owedBefore = n((await req("GET", "/purchases/invoices/SCN-D213-PI")).body?.remainingBalance);
      const applied = await req("POST", "/cheques/SCN-D221-V/allocations", { allocationId: "SCN-D221-V-A1", invoiceId: "SCN-D213-PI", amount: "3600" });
      check("D221: the cheque is applied to the CAD bill", applied.status === 201 || applied.status === 200, `status ${applied.status} ${JSON.stringify(applied.body).slice(0, 200)}`);
      checkEq("D221: CAD 100 bought at 36.00 relieves 3,520.00 of the bill; the 80.00 more paid is a realised loss on 5900", (await glBalanceOf("5900")) - start.loss, 80);
      checkEq("D221: 2100 takes the 80.00 back so it holds only what is owed at the booked rate", (await glBalanceOf("2100")) - apBefore, -80);
      checkEq("D221: the bill owes 3,520.00 less than before", n((await req("GET", "/purchases/invoices/SCN-D213-PI")).body?.remainingBalance), owedBefore - 3520);
      now = await exact();
      check("D221: the AP sub-ledger still ties to the micro-unit", now.exact.ap === start.invariants.exact.ap, `ap ${now.ap}`);

      await req("POST", "/cheques/SCN-D221-V/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" });
      const bounced = await req("POST", "/cheques/SCN-D221-V/bounce", { date: "2026-08-28" });
      check("the bank returns the cheque", bounced.status === 200 && bounced.body?.status === "bounced", `status ${bounced.status} ${JSON.stringify(bounced.body).slice(0, 200)}`);
      checkEq("D221: the bounce takes the realised loss back off 5900", (await glBalanceOf("5900")) - start.loss, 0);
      checkEq("D221: and the bill owes what it did before the cheque", n((await req("GET", "/purchases/invoices/SCN-D213-PI")).body?.remainingBalance), owedBefore);
      now = await exact();
      check("D221: AR, AP and inventory all still tie to the micro-unit", now.exact.ar === start.invariants.exact.ar && now.exact.ap === start.invariants.exact.ap && now.exact.inventory === start.invariants.exact.inventory, `ar ${now.ar} ap ${now.ap} inventory ${now.inventory}`);
      check("the supplier ladder still ties to 2100", (await req("GET", "/reports/aging/suppliers")).body?.reconciliation?.withinTolerance === true);
      check("the customer ladder still ties to 1105", (await req("GET", "/reports/aging/customers")).body?.reconciliation?.withinTolerance === true);

      const exceptions = (await req("GET", "/reports/returns/fx-face-value")).body;
      check("D222: every return this tenant has posted carries its invoice's rate, so the face-value exceptions report is empty", Array.isArray(exceptions?.rows) && exceptions.rows.length === 0, JSON.stringify(exceptions?.rows ?? exceptions).slice(0, 240));
    } finally {
      const restored = await req("PUT", "/settings", { ...(await req("GET", "/settings")).body, multiCurrencyEnabled: base?.multiCurrencyEnabled, secondaryCurrencies: currencies });
      check("the currency settings are restored", restored.status === 200, `status ${restored.status}`);
    }
  });
}
