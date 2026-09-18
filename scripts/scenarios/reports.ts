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
