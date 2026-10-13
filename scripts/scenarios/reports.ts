import { toTenantDay } from "@mezan/domain";
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
  readonly value: number | string;
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
        `${label} KPI values are all real figures — a number, or an exact decimal string for money (D345)`,
        kpis.every((entry) =>
          typeof entry.value === "number"
            ? Number.isFinite(entry.value)
            : typeof entry.value === "string" && entry.format === "money" && /^-?\d+\.\d{6}$/.test(entry.value),
        ),
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
    // A panel is asked for the window its row was computed over, as the screen
    // asks for it (D281, D286) — the report echoes its own params back.
    const allTime = "fromDate=2000-01-01&asOfDate=2099-12-31";
    const bySupplier = await ctx.req("GET", "/reports/purchases/by-supplier?dateFrom=2000-01-01&dateTo=2099-12-31");
    const supplierRow = (bySupplier.body?.rows ?? [])[0];
    ctx.check("a supplier report row to drill into", Boolean(supplierRow?.supplierId), JSON.stringify(supplierRow).slice(0, 120));
    if (supplierRow?.supplierId) {
      const panel = await ctx.req("GET", `/reports/drill-down/supplier/${supplierRow.supplierId}?${allTime}`);
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
      const panel = await ctx.req("GET", `/reports/drill-down/customer/${customerRow.customerId}?${allTime}`);
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
    // postings; they must land on the same balance. The panel is asked for
    // the trial balance's own day, as the screen asks for it (D281).
    const tb = await ctx.req("GET", "/financial-reports/trial-balance");
    const asOfDate = String(tb.body?.params?.asOfDate ?? "");
    const active = (tb.body?.rows ?? []).filter((r: any) => ctx.n(r.debit) + ctx.n(r.credit) > 0);
    ctx.check("the trial balance names the day it was computed for", /^\d{4}-\d{2}-\d{2}$/.test(asOfDate), asOfDate);
    ctx.check("the trial balance has accounts to drill into", active.length > 0);
    const drifted: string[] = [];
    for (const row of active) {
      const panel = await ctx.req("GET", `/reports/drill-down/account/${row.accountId}?asOfDate=${asOfDate}`);
      const balance = ctx.scaled((panel.body?.facts ?? []).find((f: any) => f.key === "balance")?.value);
      const expected = ctx.scaled((ctx.n(row.debit) - ctx.n(row.credit)).toFixed(2));
      if (panel.status !== 200 || balance === null || balance !== expected) drifted.push(`${row.code} ${balance} vs ${expected}`);
    }
    ctx.check("every account drill-down's balance equals the trial balance's own row", drifted.length === 0, drifted.slice(0, 5).join("; "));
    const account = active[0];
    if (account?.accountId) {
      const panel = await ctx.req("GET", `/reports/drill-down/account/${account.accountId}`);
      ctx.check("account drill-down responds", panel.status === 200, `status ${panel.status}`);
      const balance = ctx.n((panel.body?.facts ?? []).find((f: any) => f.key === "balance")?.value);
      ctx.checkEq(
        "an account drill-down with no date defaults to the trial balance's own day",
        balance,
        ctx.n(account.debit) - ctx.n(account.credit),
      );
      ctx.check(
        "account drill-down names the journal entries behind it",
        (panel.body?.documents ?? []).every((d: any) => d.type === "JOURNAL_ENTRY" && d.date <= asOfDate),
        JSON.stringify(panel.body?.documents).slice(0, 160),
      );
    }

    // The income statement's figure is a period's movement; its panel is asked
    // for that period.
    const period = { from: `${asOfDate.slice(0, 4)}-01-01`, to: asOfDate };
    const income = await ctx.req("GET", `/financial-reports/income-statement?periodFrom=${period.from}&periodTo=${period.to}`);
    const incomeDrift: string[] = [];
    for (const row of income.body?.rows ?? []) {
      const panel = await ctx.req("GET", `/reports/drill-down/account/${row.accountId}?fromDate=${period.from}&asOfDate=${period.to}`);
      const balance = ctx.scaled((panel.body?.facts ?? []).find((f: any) => f.key === "balance")?.value);
      const expected = ctx.scaled((-ctx.n(row.amount)).toFixed(2));
      if (panel.status !== 200 || balance === null || balance !== expected) incomeDrift.push(`${row.code} ${balance} vs ${expected}`);
    }
    ctx.check("every income-statement account drill-down equals its row for the period", incomeDrift.length === 0, incomeDrift.slice(0, 5).join("; "));

    // D286 — the non-GL twin of D281: a panel must land on the aging ladder
    // row, the period row and the warehouse-filtered stock row it was opened
    // from, not on an all-time, all-branch, all-warehouse reading of its own.
    const ladderDrift: string[] = [];
    for (const kind of ["customers", "suppliers"] as const) {
      const ladder = await ctx.req("GET", `/reports/aging/${kind}`);
      const ladderAsOf = String(ladder.body?.params?.asOfDate ?? "");
      const entity = kind === "customers" ? "customer" : "supplier";
      const idKey = kind === "customers" ? "customerId" : "supplierId";
      ctx.check(`the ${entity} ladder names the day it was computed for`, /^\d{4}-\d{2}-\d{2}$/.test(ladderAsOf), ladderAsOf);
      ctx.check(`the ${entity} ladder has rows to drill into`, (ladder.body?.rows ?? []).length > 0);
      for (const row of ladder.body?.rows ?? []) {
        const panel = await ctx.req("GET", `/reports/drill-down/${entity}/${encodeURIComponent(row[idKey])}?asOfDate=${ladderAsOf}`);
        const owed = ctx.scaled((panel.body?.facts ?? []).find((f: any) => f.key === "outstanding")?.value);
        const expected = ctx.scaled(ctx.n(row.total).toFixed(2));
        if (panel.status !== 200 || owed === null || owed !== expected) ladderDrift.push(`${row[idKey]} ${owed} vs ${expected}`);
      }
    }
    ctx.check("every aging drill-down's المستحق equals the ladder's own row", ladderDrift.length === 0, ladderDrift.slice(0, 5).join("; "));

    const monthFrom = `${asOfDate.slice(0, 7)}-01`;
    const periodDrift: string[] = [];
    // The check that was missing when D286 was believed closed: it compared
    // only «إجمالي المفوتر» against the row's total, so the panel answering the
    // aging ladder's balance to a period row's «المتبقي» went unseen —
    // SUPP-DEMO-1 read 2,300.00 on the row and 1,455,097.00 on its own panel.
    const remainingDrift: string[] = [];
    for (const [report, entity, idKey, extra] of [
      ["sales/by-customer", "customer", "customerId", "&taxMode=inc"],
      ["purchases/by-supplier", "supplier", "supplierId", ""],
    ] as const) {
      const run = await ctx.req("GET", `/reports/${report}?dateFrom=${monthFrom}&dateTo=${asOfDate}${extra}`);
      for (const row of run.body?.rows ?? []) {
        const panel = await ctx.req("GET", `/reports/drill-down/${entity}/${encodeURIComponent(row[idKey])}?fromDate=${monthFrom}&asOfDate=${asOfDate}`);
        const facts = panel.body?.facts ?? [];
        const billed = ctx.scaled(facts.find((f: any) => f.key === "billed")?.value);
        const expected = ctx.scaled(ctx.n(row.total).toFixed(2));
        if (panel.status !== 200 || billed === null || billed !== expected) periodDrift.push(`${row[idKey]} ${billed} vs ${expected}`);
        const remaining = ctx.scaled(facts.find((f: any) => f.key === "periodOutstanding")?.value);
        const expectedRemaining = ctx.scaled(ctx.n(row.outstanding).toFixed(2));
        if (panel.status !== 200 || remaining === null || remaining !== expectedRemaining) {
          remainingDrift.push(`${row[idKey]} ${remaining} vs ${expectedRemaining}`);
        }
      }
    }
    ctx.check("every period drill-down's total equals its row over the SAME period", periodDrift.length === 0, periodDrift.slice(0, 5).join("; "));
    ctx.check(
      "every period drill-down's المتبقي من فواتير الفترة equals its row's own column",
      remainingDrift.length === 0,
      remainingDrift.slice(0, 5).join("; "),
    );

    const warehouses = ctx.rows((await ctx.req("GET", "/warehouses")).body).map((w: any) => w.id);
    const stockDrift: string[] = [];
    for (const warehouseId of warehouses) {
      const run = await ctx.req("GET", `/reports/inventory/valuation?warehouseId=${encodeURIComponent(warehouseId)}`);
      for (const row of run.body?.rows ?? []) {
        const panel = await ctx.req("GET", `/reports/drill-down/item/${encodeURIComponent(row.itemId)}?warehouseId=${encodeURIComponent(warehouseId)}`);
        const value = ctx.scaled((panel.body?.facts ?? []).find((f: any) => f.key === "value")?.value);
        const expected = ctx.scaled(ctx.n(row.totalValue).toFixed(2));
        if (panel.status !== 200 || value === null || value !== expected) stockDrift.push(`${warehouseId}/${row.itemId} ${value} vs ${expected}`);
      }
    }
    ctx.check("every item drill-down's value equals its row in the SAME warehouse", stockDrift.length === 0, stockDrift.slice(0, 5).join("; "));

    const inverted = await ctx.req("GET", `/reports/drill-down/customer/${customerRow?.customerId ?? "CUST-DEMO-1"}?fromDate=${asOfDate}&asOfDate=${monthFrom}`);
    ctx.check("an inverted drill-down window is refused", inverted.status === 400, `status ${inverted.status}`);
    const malformed = await ctx.req("GET", "/reports/drill-down/item/ITEM-DEMO-1?asOfDate=19-09-2026");
    ctx.check("a malformed drill-down date is refused", malformed.status === 400, `status ${malformed.status}`);

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

async function glBalance(ctx: Ctx, accountId: string, asOf?: string): Promise<number> {
  const res = await ctx.req("GET", `/gl/accounts/${accountId}/ledger${asOf ? `?asOf=${asOf}` : ""}`);
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
    // The ladders stand as of today; the control accounts are read as of the
    // same day, so a seeded document dated later is in neither.
    const customers = await ctx.req("GET", "/reports/aging/customers");
    const ar = await glBalance(ctx, "1105", customers.body?.params?.asOfDate);
    ctx.check("aging customers: the reconciliation banner holds", customers.body?.reconciliation?.withinTolerance === true, JSON.stringify(customers.body?.reconciliation));
    ctx.checkEq("aging customers: the ladder total is the 1105 balance", ctx.n(customers.body?.grandTotals?.total), ar);

    const suppliers = await ctx.req("GET", "/reports/aging/suppliers");
    const ap = -(await glBalance(ctx, "2100", suppliers.body?.params?.asOfDate));
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
 * D213, D214, D215, D221, D222, D242 on the seeded tenant, in CAD — this scenario's
 * own currency, so its open positions and revaluation stay out of every other
 * module's. CAD is 35.20 on the 23rd and 36.00 from the 26th; the settings are
 * restored afterwards.
 */
export async function foreignRatesSettleAndReturnInputs_D213_D222(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, n } = ctx;
  const booked = ctx.onCalendar("2026-08-24");
  const settled = ctx.onCalendar("2026-08-27");
  const glBalanceOf = (accountId: string) => glBalance(ctx, accountId);
  const exact = async () => ctx.invariants();

  await ctx.scenario("D213–D222 — a CAD bill balances line by line, raw returns read their invoice, and settling at 36.00 what was booked at 35.20 realises the difference", async () => {
    const base = (await req("GET", "/settings")).body;
    const currencies: string[] = base?.secondaryCurrencies ?? [];
    const enabled = await req("PUT", "/settings", { ...base, multiCurrencyEnabled: true, secondaryCurrencies: [...currencies.filter((c) => c !== "CAD"), "CAD"] });
    check("multi-currency is on with CAD allowed", enabled.status === 200, `status ${enabled.status}`);
    for (const [id, rate, date] of [["SCN-D221-CAD-23", "35.20", ctx.onCalendar("2026-08-23")], ["SCN-D221-CAD-26", "36.00", ctx.onCalendar("2026-08-26")]] as const) {
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
      const start = { ar: await glBalanceOf("1105"), ap: await glBalanceOf("2100"), gain: await glBalanceOf("4920"), loss: await glBalanceOf("5920"), tillOver: await glBalanceOf("4900"), tillShort: await glBalanceOf("5900"), invariants: await exact() };

      // D213 — three lines at 0.333333 convert to one micro-unit more, line by
      // line, than their sum converted once.
      const bill = await req("POST", "/purchases/invoices", {
        id: "SCN-D213-PI", supplierId: "SCN-D213-SUPP", date: booked, dueDate: ctx.onCalendar("2026-09-23"), warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "CAD", projectId: "PRJ-DEMO-1",
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
        id: "SCN-D214-SI", date: booked, dueDate: ctx.onCalendar("2026-09-23"), customerId: "SCN-D221-CUST", customerNameAr: "عميل بالدولار الكندي",
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
      const openSales = (await req("GET", "/open-invoices?kind=sales&partyId=SCN-D221-CUST")).body as any[];
      check("D242: an invoice its return cleared is no longer offered for allocation", Array.isArray(openSales) && !openSales.some((row) => row.id === "SCN-D214-SI"), JSON.stringify(openSales).slice(0, 200));
      const openBill = ((await req("GET", "/open-invoices?kind=purchase&partyId=SCN-D213-SUPP")).body as any[]).find((row) => row.id === "SCN-D213-PI");
      check("D242: the bill is offered net of its 802.56 return", ctx.scaled(openBill?.outstanding) === 8090837287n - 802560000n && ctx.scaled(openBill?.returned) === 802560000n, JSON.stringify(openBill));

      // D221 — a customer pays CAD 100 booked at 35.20 with EGP at 36.00.
      await req("POST", "/sales-invoices", {
        id: "SCN-D221-SI", date: booked, dueDate: ctx.onCalendar("2026-09-23"), customerId: "SCN-D221-CUST", customerNameAr: "عميل بالدولار الكندي",
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
      checkEq("D229: the 80.00 difference is a realised gain on 4920 أرباح فروق العملة المحققة", (await glBalanceOf("4920")) - start.gain, -80);
      checkEq("D229: and فائض الصندوق 4900 does not move", (await glBalanceOf("4900")) - start.tillOver, 0);
      const pnl = (await req("GET", `/financial-reports/income-statement?periodFrom=${settled.slice(0, 8)}01&periodTo=${settled}`)).body;
      const gainRow = ((pnl?.rows ?? []) as any[]).find((row) => row.accountId === "4920");
      check("D229: the income statement shows the realised gain under other income, not revenue", gainRow?.sectionKey === "otherIncome", JSON.stringify(gainRow ?? null));
      now = await exact();
      check("D221: the AR sub-ledger still ties to the micro-unit", now.exact.ar === start.invariants.exact.ar, `ar ${now.ar}`);
      const statement = (await req("GET", "/reports/statements/customers/SCN-D221-CUST")).body;
      check("D221: the customer's statement shows the realised difference and closes on their ladder row", statement?.closing === statement?.agingTotal && (statement?.lines ?? []).some((line: any) => line.kind === "fx_difference" && n(line.increase) === 80), JSON.stringify({ closing: statement?.closing, aging: statement?.agingTotal }));
      const revaluation = (await req("POST", "/revaluation/preview", { date: ctx.onCalendar("2026-08-31"), currencies: ["CAD"] })).body;
      const arDetail = ((revaluation?.details ?? []) as any[]).find((detail) => detail.accountId === "1105");
      check("D260: month-end revaluation finds nothing left open on 1105 in CAD — the EGP receipt closed the CAD it paid", !arDetail, JSON.stringify(arDetail ?? null));

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
      checkEq("D229: CAD 100 bought at 36.00 relieves 3,520.00 of the bill; the 80.00 more paid is a realised loss on 5920 خسائر فروق العملة المحققة", (await glBalanceOf("5920")) - start.loss, 80);
      checkEq("D229: and عجز الصندوق 5900 does not move", (await glBalanceOf("5900")) - start.tillShort, 0);
      checkEq("D221: 2100 takes the 80.00 back so it holds only what is owed at the booked rate", (await glBalanceOf("2100")) - apBefore, -80);
      checkEq("D221: the bill owes 3,520.00 less than before", n((await req("GET", "/purchases/invoices/SCN-D213-PI")).body?.remainingBalance), owedBefore - 3520);
      now = await exact();
      check("D221: the AP sub-ledger still ties to the micro-unit", now.exact.ap === start.invariants.exact.ap, `ap ${now.ap}`);

      await req("POST", "/cheques/SCN-D221-V/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" });
      const bounced = await req("POST", "/cheques/SCN-D221-V/bounce", { date: ctx.onCalendar("2026-08-28") });
      check("the bank returns the cheque", bounced.status === 200 && bounced.body?.status === "bounced", `status ${bounced.status} ${JSON.stringify(bounced.body).slice(0, 200)}`);
      checkEq("D221: the bounce takes the realised loss back off 5920", (await glBalanceOf("5920")) - start.loss, 0);
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

/**
 * D260 on the seeded tenant, in GBP — this scenario's own currency. GBP is
 * 60.00 when the documents are booked, 62.00 when they are settled and 59.00
 * at month-end, so a position the settlement failed to close shows up as a
 * restatement. Every position is closed again before the settings are restored.
 */
export async function foreignSettledInBaseIsNotRevalued_D260(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, n } = ctx;
  const glBalanceOf = (accountId: string) => glBalance(ctx, accountId);
  const monthEnd = ctx.onCalendar("2026-08-31");
  const today = toTenantDay(new Date().toISOString());
  const detailOn = async (accountId: string, date = monthEnd) => {
    const preview = (await req("POST", "/revaluation/preview", { date, currencies: ["GBP"] })).body;
    return ((preview?.details ?? []) as any[]).find((detail) => detail.accountId === accountId) ?? null;
  };

  await ctx.scenario("D260 — GBP invoices and bills settled in EGP at 62.00 leave nothing for a 59.00 month-end to restate, and an undone settlement reopens them", async () => {
    const base = (await req("GET", "/settings")).body;
    const currencies: string[] = base?.secondaryCurrencies ?? [];
    const enabled = await req("PUT", "/settings", { ...base, multiCurrencyEnabled: true, secondaryCurrencies: [...currencies.filter((c) => c !== "GBP"), "GBP"] });
    check("multi-currency is on with GBP allowed", enabled.status === 200, `status ${enabled.status}`);
    for (const [id, rate, date] of [["SCN-D260-GBP-20", "60.00", ctx.onCalendar("2026-08-20")], ["SCN-D260-GBP-25", "62.00", ctx.onCalendar("2026-08-25")], ["SCN-D260-GBP-29", "59.00", ctx.onCalendar("2026-08-29")]] as const) {
      await req("POST", "/exchange-rates", { id, currency: "GBP", rate, effectiveDate: date, rateType: "standard", source: "manual" });
      check(`a GBP rate of ${rate} is approved from ${date}`, (await req("POST", `/exchange-rates/${id}/approve`, {})).body?.status === "approved");
    }
    try {
      const start = { gain: await glBalanceOf("4920"), loss: await glBalanceOf("5920"), invariants: await ctx.invariants() };
      await req("POST", "/items", { id: "SCN-D260-SVC", code: "SCN-D260-SVC", nameAr: "خدمة بالجنيه الإسترليني", type: "service", baseUnitCode: "PCS", trackInventory: false, taxRatePercent: 0, revenueAccountId: "4100" });
      await req("POST", "/customers", { id: "SCN-D260-CUST", code: "SCN-D260-CUST", nameAr: "عميل بالجنيه الإسترليني", paymentTermsDays: 30, currency: "GBP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
      await req("POST", "/suppliers", { id: "SCN-D260-SUPP", code: "SCN-D260-SUPP", nameAr: "مورد بالجنيه الإسترليني", currency: "GBP", openingBalance: "0" });
      for (const id of ["SCN-D260-SI1", "SCN-D260-SI2"]) {
        await req("POST", "/sales-invoices", {
          id, date: ctx.onCalendar("2026-08-22"), dueDate: ctx.onCalendar("2026-09-21"), customerId: "SCN-D260-CUST", customerNameAr: "عميل بالجنيه الإسترليني",
          warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "GBP", arAccountId: "1105", taxAccountId: "2200",
          lines: [{ lineId: `${id}-L1`, itemId: "SCN-D260-SVC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
        });
        check(`${id}: GBP 100 confirms at 60.00`, (await req("POST", `/sales-invoices/${id}/confirm`, {})).status === 200);
      }
      const bill = await req("POST", "/purchases/invoices", {
        id: "SCN-D260-PI", supplierId: "SCN-D260-SUPP", date: ctx.onCalendar("2026-08-22"), dueDate: ctx.onCalendar("2026-09-21"), warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "GBP",
        lines: [{ itemId: null, kind: "expense", description: "خدمة بالجنيه الإسترليني", qty: "1", unitCost: "100", taxRatePercent: 0 }],
      });
      check("a GBP 100 bill confirms at 60.00", bill.status === 201 && (await req("POST", "/purchases/invoices/SCN-D260-PI/confirm", {})).status === 200);
      const arOpen = await detailOn("1105", ctx.onCalendar("2026-08-24"));
      check("before any settlement, 1105 holds GBP 200 booked at 12,000.00", n(arOpen?.foreignAmount) === 200 && n(arOpen?.bookedBase) === 12000, JSON.stringify(arOpen));

      // The customer side: one invoice collected in full, the other half.
      const full = await req("POST", "/sales-invoices/SCN-D260-SI1/payments", { amount: "6200", treasuryAccountId: "TR-DEMO-CASH", date: ctx.onCalendar("2026-08-26") });
      check("D260: EGP 6,200.00 at 62.00 collects SCN-D260-SI1 in full", full.status === 200 && (await req("GET", "/sales-invoices/SCN-D260-SI1")).body?.status === "paid", `status ${full.status}`);
      const cashGl = String((await req("GET", "/treasury-accounts/TR-DEMO-CASH")).body?.glAccountId);
      const receipt = await req("POST", "/vouchers", {
        id: "SCN-D260-CV", date: ctx.onCalendar("2026-08-26"), voucherType: "customer_collection", amount: "3100", branchId: "BR-MAIN", paymentMethod: "cash",
        treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: cashGl, counterpartyGlAccountId: "1105", customerId: "SCN-D260-CUST",
      });
      check("an EGP 3,100.00 receipt posts", receipt.status === 201 && (await req("POST", "/vouchers/SCN-D260-CV/confirm", {})).status === 200);
      const half = await req("POST", "/vouchers/SCN-D260-CV/allocations", { allocationId: "SCN-D260-CV-A1", invoiceId: "SCN-D260-SI2", amount: "3100" });
      check("and is applied to SCN-D260-SI2", half.status === 201, `status ${half.status} ${JSON.stringify(half.body).slice(0, 200)}`);
      checkEq("D221: the two settlements realise 200.00 + 100.00 on 4920", (await glBalanceOf("4920")) - start.gain, -300);
      let ar = await detailOn("1105", today);
      check("D260: at 59.00 a revaluation today restates only the GBP 50 still owed, booked at 3,000.00, by −50.00", n(ar?.foreignAmount) === 50 && n(ar?.bookedBase) === 3000 && n(ar?.delta) === -50, JSON.stringify(ar));
      ar = await detailOn("1105");
      check("D265: the receipt was applied by hand today, so at the August close SCN-D260-SI2 was still open — GBP 100 at 6,000.00", n(ar?.foreignAmount) === 100 && n(ar?.bookedBase) === 6000 && n(ar?.delta) === -100, JSON.stringify(ar));

      const reversed = await req("POST", "/vouchers/SCN-D260-CV/reverse", { memo: "سبب العكس", date: ctx.onCalendar("2026-08-28") });
      check("the part receipt is reversed on the 28th", reversed.status === 201, `status ${reversed.status} ${JSON.stringify(reversed.body).slice(0, 200)}`);
      ar = await detailOn("1105");
      check("D260: the reversal reopens all of SCN-D260-SI2 — GBP 100 at 6,000.00, restated by −100.00", n(ar?.foreignAmount) === 100 && n(ar?.bookedBase) === 6000 && n(ar?.delta) === -100, JSON.stringify(ar));
      ar = await detailOn("1105", today);
      check("D265: and today, the reversal undid the allocation — GBP 100 at 6,000.00", n(ar?.foreignAmount) === 100 && n(ar?.bookedBase) === 6000, JSON.stringify(ar));
      const rest = await req("POST", "/sales-invoices/SCN-D260-SI2/payments", { amount: "6200", treasuryAccountId: "TR-DEMO-CASH", date: ctx.onCalendar("2026-08-28") });
      check("D260: EGP 6,200.00 then collects SCN-D260-SI2 in full", rest.status === 200 && (await req("GET", "/sales-invoices/SCN-D260-SI2")).body?.status === "paid", `status ${rest.status}`);
      ar = await detailOn("1105");
      check("D260: and a 59.00 month-end finds nothing on 1105 in GBP", ar === null, JSON.stringify(ar));

      // The supplier side: paid by an EGP «شيك», which bounces, then paid in cash.
      const bankGl = String((await req("GET", "/treasury-accounts/TR-DEMO-BANK")).body?.glAccountId);
      const payment = (id: string, method: "cheque" | "cash", date: string) => ({
        id, date, voucherType: "supplier_payment", amount: "6200", branchId: "BR-MAIN", paymentMethod: method, referenceNo: id,
        treasuryAccountId: "TR-DEMO-BANK", treasuryGlAccountId: bankGl, counterpartyGlAccountId: "2100", supplierId: "SCN-D260-SUPP",
      });
      check("an EGP 6,200.00 «شيك» payment posts", (await req("POST", "/vouchers", payment("SCN-D260-PV1", "cheque", ctx.onCalendar("2026-08-26")))).status === 201 && (await req("POST", "/vouchers/SCN-D260-PV1/confirm", {})).status === 200);
      const applied = await req("POST", "/cheques/SCN-D260-PV1/allocations", { allocationId: "SCN-D260-PV1-A1", invoiceId: "SCN-D260-PI", amount: "6200" });
      check("and its cheque pays the GBP bill in full", applied.status === 201 && n((await req("GET", "/purchases/invoices/SCN-D260-PI")).body?.remainingBalance) === 0, `status ${applied.status}`);
      checkEq("D221: paying 200.00 more than booked is a realised loss on 5920", (await glBalanceOf("5920")) - start.loss, 200);
      let ap = await detailOn("2100", today);
      check("D260: a 59.00 revaluation today finds nothing on 2100 in GBP", ap === null, JSON.stringify(ap));
      ap = await detailOn("2100");
      check("D265: the cheque was applied by hand today, so at the August close the bill was still open", n(ap?.foreignAmount) === 100 && n(ap?.bookedBase) === 6000, JSON.stringify(ap));
      await req("POST", "/cheques/SCN-D260-PV1/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" });
      const bounced = await req("POST", "/cheques/SCN-D260-PV1/bounce", { date: ctx.onCalendar("2026-08-28") });
      check("the bank returns the cheque on the 28th", bounced.status === 200 && bounced.body?.status === "bounced", `status ${bounced.status}`);
      ap = await detailOn("2100");
      check("D260: the bounce reopens the bill — GBP 100 at 6,000.00, which a 59.00 close restates as a 100.00 gain", n(ap?.foreignAmount) === 100 && n(ap?.bookedBase) === 6000 && n(ap?.gainLoss) === 100, JSON.stringify(ap));
      ap = await detailOn("2100", today);
      check("D265: and today, the bounce undid the cheque's allocation — GBP 100 open", n(ap?.foreignAmount) === 100 && n(ap?.bookedBase) === 6000, JSON.stringify(ap));
      check("an EGP 6,200.00 cash payment posts", (await req("POST", "/vouchers", payment("SCN-D260-PV2", "cash", ctx.onCalendar("2026-08-28")))).status === 201 && (await req("POST", "/vouchers/SCN-D260-PV2/confirm", {})).status === 200);
      check("and pays the bill again", (await req("POST", "/vouchers/SCN-D260-PV2/allocations", { allocationId: "SCN-D260-PV2-A1", invoiceId: "SCN-D260-PI", amount: "6200" })).status === 201);
      ap = await detailOn("2100", today);
      check("D260: a 59.00 revaluation today finds nothing on 2100 in GBP again", ap === null, JSON.stringify(ap));
      const preview = (await req("POST", "/revaluation/preview", { date: today, currencies: ["GBP"] })).body;
      check("D260: a GBP preview today has nothing to post", preview?.hasImpact === false && n(preview?.totalGain) === 0 && n(preview?.totalLoss) === 0, JSON.stringify(preview).slice(0, 300));

      checkEq("the realised gains on 4920 are 200.00 + 200.00", (await glBalanceOf("4920")) - start.gain, -400);
      checkEq("the realised loss on 5920 is the second payment's 200.00", (await glBalanceOf("5920")) - start.loss, 200);
      const now = await ctx.invariants();
      check("AR, AP and inventory all still tie to the micro-unit", now.exact.ar === start.invariants.exact.ar && now.exact.ap === start.invariants.exact.ap && now.exact.inventory === start.invariants.exact.inventory, `ar ${now.ar} ap ${now.ap} inventory ${now.inventory}`);
      check("the customer ladder still ties to 1105", (await req("GET", "/reports/aging/customers")).body?.reconciliation?.withinTolerance === true);
      check("the supplier ladder still ties to 2100", (await req("GET", "/reports/aging/suppliers")).body?.reconciliation?.withinTolerance === true);
      const statement = (await req("GET", "/reports/statements/customers/SCN-D260-CUST")).body;
      check("the customer's statement closes at 0 on their ladder row", n(statement?.closing) === 0 && statement?.closing === statement?.agingTotal, JSON.stringify({ closing: statement?.closing, aging: statement?.agingTotal }));
    } finally {
      const restored = await req("PUT", "/settings", { ...(await req("GET", "/settings")).body, multiCurrencyEnabled: base?.multiCurrencyEnabled, secondaryCurrencies: currencies });
      check("the currency settings are restored", restored.status === 200, `status ${restored.status}`);
    }
  });
}

/**
 * D265 on the seeded tenant, in AED — no other scenario books it. An EGP
 * receipt dated 26 August sits on account, and today it is applied to half an
 * AED invoice, undone and applied again. The settlement is dated the day it
 * was made, so on every day from the receipt to today revaluation, 4920, 1105
 * and the customer's ladder row tell one story, and never two settlements.
 */
export async function allocationUndoneAndMadeAgainSettlesOnce_D265(ctx: Ctx): Promise<void> {
  const { req, check, n } = ctx;
  const today = toTenantDay(new Date().toISOString());
  const days: string[] = [];
  for (let at = Date.parse(`${ctx.onCalendar("2026-08-26")}T00:00:00Z`); at <= Date.parse(`${today}T00:00:00Z`); at += 86_400_000) days.push(new Date(at).toISOString().slice(0, 10));
  const balanceOn = async (accountId: string, date: string) => n((await req("GET", `/gl/accounts/${accountId}/ledger?asOf=${date}`)).body?.balance?.balance);
  const snapshot = async (date: string) => {
    const preview = (await req("POST", "/revaluation/preview", { date, currencies: ["AED"] })).body;
    const position = ((preview?.details ?? []) as any[]).find((detail) => detail.accountId === "1105") ?? null;
    const ladder = (await req("GET", `/reports/aging/customers?asOfDate=${date}`)).body;
    const row = ((ladder?.rows ?? []) as any[]).find((r) => r.customerId === "SCN-D265-CUST");
    return { foreign: n(position?.foreignAmount), booked: n(position?.bookedBase), gain: await balanceOn("4920", date), control: await balanceOn("1105", date), row: n(row?.total) };
  };

  await ctx.scenario("D265 — an EGP receipt applied to half an AED invoice, undone and applied again today, is one settlement dated today on every day's revaluation, GL and ladder", async () => {
    const base = (await req("GET", "/settings")).body;
    const currencies: string[] = base?.secondaryCurrencies ?? [];
    const enabled = await req("PUT", "/settings", { ...base, multiCurrencyEnabled: true, secondaryCurrencies: [...currencies.filter((c) => c !== "AED"), "AED"] });
    check("multi-currency is on with AED allowed", enabled.status === 200, `status ${enabled.status}`);
    for (const [id, rate, date] of [["SCN-D265-AED-20", "13.00", ctx.onCalendar("2026-08-20")], ["SCN-D265-AED-25", "14.00", ctx.onCalendar("2026-08-25")]] as const) {
      await req("POST", "/exchange-rates", { id, currency: "AED", rate, effectiveDate: date, rateType: "standard", source: "manual" });
      check(`an AED rate of ${rate} is approved from ${date}`, (await req("POST", `/exchange-rates/${id}/approve`, {})).body?.status === "approved");
    }
    try {
      const start = { invariants: await ctx.invariants(), days: new Map<string, Awaited<ReturnType<typeof snapshot>>>() };
      for (const day of days) start.days.set(day, await snapshot(day));
      await req("POST", "/items", { id: "SCN-D265-SVC", code: "SCN-D265-SVC", nameAr: "خدمة بالدرهم", type: "service", baseUnitCode: "PCS", trackInventory: false, taxRatePercent: 0, revenueAccountId: "4100" });
      await req("POST", "/customers", { id: "SCN-D265-CUST", code: "SCN-D265-CUST", nameAr: "عميل بالدرهم", paymentTermsDays: 30, currency: "AED", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
      await req("POST", "/sales-invoices", {
        id: "SCN-D265-SI", date: ctx.onCalendar("2026-08-22"), dueDate: ctx.onCalendar("2026-09-21"), customerId: "SCN-D265-CUST", customerNameAr: "عميل بالدرهم",
        warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "AED", arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "SCN-D265-SI-L1", itemId: "SCN-D265-SVC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
      });
      check("SCN-D265-SI: AED 100 confirms at 13.00", (await req("POST", "/sales-invoices/SCN-D265-SI/confirm", {})).status === 200);
      const cashGl = String((await req("GET", "/treasury-accounts/TR-DEMO-CASH")).body?.glAccountId);
      const receipt = await req("POST", "/vouchers", {
        id: "SCN-D265-CV", date: ctx.onCalendar("2026-08-26"), voucherType: "customer_collection", amount: "700", branchId: "BR-MAIN", paymentMethod: "cash",
        treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: cashGl, counterpartyGlAccountId: "1105", customerId: "SCN-D265-CUST",
      });
      check("an EGP 700.00 receipt dated 26 August posts on account", receipt.status === 201 && (await req("POST", "/vouchers/SCN-D265-CV/confirm", {})).status === 200);
      const apply = (id: string) => req("POST", "/vouchers/SCN-D265-CV/allocations", { allocationId: id, invoiceId: "SCN-D265-SI", amount: "700" });
      check("today it is applied to SCN-D265-SI", (await apply("SCN-D265-A1")).status === 201);
      check("the allocation is undone", (await req("POST", "/allocations/SCN-D265-A1/reverse", {})).status === 200);
      check("and applied again", (await apply("SCN-D265-A2")).status === 201);

      const dated = [];
      for (const id of ["FXR:SCN-D265-A1", "FXR:SCN-D265-A1:REV", "FXR:SCN-D265-A2"]) dated.push([id, (await req("GET", `/gl/journal-entries/${encodeURIComponent(id)}`)).body?.date]);
      check("D265: both settlements and the undo are dated today", dated.every(([, date]) => date === today), JSON.stringify(dated));

      for (const day of days) {
        const was = start.days.get(day)!;
        const now = await snapshot(day);
        const moved = { foreign: now.foreign - was.foreign, booked: now.booked - was.booked, gain: now.gain - was.gain, control: now.control - was.control, row: now.row };
        const expected = day === today
          ? { foreign: 50, booked: 650, gain: -50, control: 650, row: 650 }
          : { foreign: 100, booked: 1300, gain: 0, control: 600, row: 600 };
        check(`D265: on ${day} revaluation, 4920, 1105 and the ladder row agree — ${day === today ? "one settlement" : "the receipt on account"}`, JSON.stringify(moved) === JSON.stringify(expected), JSON.stringify(moved));
      }

      const now = await ctx.invariants();
      check("AR, AP and inventory all still tie to the micro-unit", now.exact.ar === start.invariants.exact.ar && now.exact.ap === start.invariants.exact.ap && now.exact.inventory === start.invariants.exact.inventory, `ar ${now.ar} ap ${now.ap} inventory ${now.inventory}`);
      check("the customer ladder still ties to 1105", (await req("GET", "/reports/aging/customers")).body?.reconciliation?.withinTolerance === true);
    } finally {
      const restored = await req("PUT", "/settings", { ...(await req("GET", "/settings")).body, multiCurrencyEnabled: base?.multiCurrencyEnabled, secondaryCurrencies: currencies });
      check("the currency settings are restored", restored.status === 200, `status ${restored.status}`);
    }
  });
}

/**
 * D270 — «عكس السند» sent no date, and a reversal without one used to take the
 * VOUCHER's own day for its mirror document and journal entry, rewriting the
 * ledger of a day already reported. Fixed: the route now defaults a missing
 * date to today. The distinguishing proof is the as-of aging ladder the day
 * BEFORE the reversal: under the old bug the mirror entry sat on the
 * voucher's own (much earlier) day, so every day since already read as
 * reversed; under the fix, a reversal made today has not happened yet as of
 * yesterday, and the ladder must still show the voucher standing then.
 */
export async function voucherReversalDatedByReversalDay_D270(ctx: Ctx): Promise<void> {
  const { req, check, n } = ctx;
  const today = toTenantDay(new Date().toISOString());
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const rowOn = async (date: string) => {
    const ladder = (await req("GET", `/reports/aging/customers?asOfDate=${date}`)).body;
    return ((ladder?.rows ?? []) as any[]).find((r) => r.customerId === "SCN-D270-CUST") ?? null;
  };

  await ctx.scenario("D270 — a voucher reversed with no date is dated the day it is reversed, never the voucher's own day", async () => {
    const start = await ctx.invariants();
    await req("POST", "/customers", {
      id: "SCN-D270-CUST", code: "SCN-D270-CUST", nameAr: "عميل عكس السند", paymentTermsDays: 30, currency: "EGP",
      openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto",
    });
    await req("POST", "/items", { id: "SCN-D270-SVC", code: "SCN-D270-SVC", nameAr: "خدمة", type: "service", baseUnitCode: "PCS", trackInventory: false, taxRatePercent: 0, revenueAccountId: "4100" });
    await req("POST", "/sales-invoices", {
      id: "SCN-D270-SI", date: "2026-07-01", dueDate: "2026-07-31", customerId: "SCN-D270-CUST", customerNameAr: "عميل عكس السند",
      warehouseId: "WH-MAIN", branchId: "BR-MAIN", currency: "EGP", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "SCN-D270-SI-L1", itemId: "SCN-D270-SVC", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "500", taxRatePercent: 0, revenueAccountId: "4100" }],
    });
    check("SCN-D270-SI: EGP 500.00 invoice confirms on 1 July", (await req("POST", "/sales-invoices/SCN-D270-SI/confirm", {})).status === 200);

    const cashGl = String((await req("GET", "/treasury-accounts/TR-DEMO-CASH")).body?.glAccountId);
    const receipt = await req("POST", "/vouchers", {
      id: "SCN-D270-CV", date: "2026-07-05", voucherType: "customer_collection", amount: "500", branchId: "BR-MAIN", paymentMethod: "cash",
      treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: cashGl, counterpartyGlAccountId: "1105", customerId: "SCN-D270-CUST",
    });
    check("an EGP 500.00 receipt posts on 5 July", receipt.status === 201 && (await req("POST", "/vouchers/SCN-D270-CV/confirm", {})).status === 200);
    const applied = await req("POST", "/vouchers/SCN-D270-CV/allocations", { allocationId: "SCN-D270-A1", invoiceId: "SCN-D270-SI", amount: "500" });
    check("and settles SCN-D270-SI in full", applied.status === 201 && (await req("GET", "/sales-invoices/SCN-D270-SI")).body?.status === "paid", JSON.stringify(applied.body).slice(0, 200));

    const beforeReversalYesterday = await rowOn(yesterday);
    check("setup: before the reversal, yesterday's ladder already reads the invoice settled", n(beforeReversalYesterday?.total) === 0, JSON.stringify(beforeReversalYesterday));

    const reversed = await req("POST", "/vouchers/SCN-D270-CV/reverse", { memo: "سبب العكس" });
    check("D270: reversing with no date defaults to today, not the voucher's own 5 July", reversed.status === 201 && reversed.body?.reversal?.date === today, JSON.stringify(reversed.body).slice(0, 300));

    const stillSettledYesterday = await rowOn(yesterday);
    check("D270: the as-of ladder the day BEFORE the reversal still shows the voucher standing — the reversal has not happened yet as of yesterday", n(stillSettledYesterday?.total) === 0, JSON.stringify(stillSettledYesterday));

    const reopenedToday = await rowOn(today);
    check("D270: today the reversal has reopened the invoice to its full 500.00", n(reopenedToday?.total) === 500, JSON.stringify(reopenedToday));

    const past = await req("POST", "/vouchers", {
      id: "SCN-D270-CV2", date: "2026-07-10", voucherType: "customer_collection", amount: "10", branchId: "BR-MAIN", paymentMethod: "cash",
      treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: cashGl, counterpartyGlAccountId: "1105", customerId: "SCN-D270-CUST",
    });
    check("a second EGP 10.00 receipt posts on 10 July", past.status === 201 && (await req("POST", "/vouchers/SCN-D270-CV2/confirm", {})).status === 200);
    const tooEarly = await req("POST", "/vouchers/SCN-D270-CV2/reverse", { memo: "سبب العكس", date: "2026-07-01" });
    check("D270: a reversal dated before the voucher's own day is refused, bilingually", tooEarly.status === 422 && tooEarly.body?.error === "REVERSAL_DATE_BEFORE_ORIGINAL" && typeof tooEarly.body?.messageEn === "string" && tooEarly.body.messageEn.length > 0, JSON.stringify(tooEarly.body));
    check("and nothing posted for the refused reversal — the second receipt is still confirmed", (await req("GET", "/vouchers/SCN-D270-CV2")).body?.status === "confirmed");

    const now = await ctx.invariants();
    check("AR, AP and inventory all still tie to the micro-unit", now.exact.ar === start.exact.ar && now.exact.ap === start.exact.ap && now.exact.inventory === start.exact.inventory, `ar ${now.ar} ap ${now.ap} inventory ${now.inventory}`);
    check("the customer ladder still ties to 1105", (await req("GET", "/reports/aging/customers")).body?.reconciliation?.withinTolerance === true);
  });
}

/**
 * D275 — the same fault D270 fixed for vouchers, one bounded context over:
 * `POST /depreciation/runs/:id/reverse` sent no date, and a reversal without
 * one took the RUN's own period-end day. Fixed: the route now defaults a
 * missing date to today, refuses a date before the run's own day, and — the
 * QuickBooks/Odoo norm — refuses to reverse a run while a LATER posted run
 * still stands on the same asset (reverse newest-first).
 *
 * The distinguishing proof is the money trail, not the flag: after BOTH runs
 * are fully reversed, the asset's own accumulated-depreciation figure and the
 * accumulated-depreciation CONTROL ACCOUNT it posts to must tie back to
 * exactly where they started — not merely both read a plausible number.
 */
export async function depreciationRunReversalDatedByReversalDay_D275(ctx: Ctx): Promise<void> {
  const { req, check, checkEq, n } = ctx;

  await ctx.scenario(
    "D275 — a depreciation-run reversal with no date is dated the day it is reversed, and only the latest posted run may be reversed",
    async () => {
      const categories = ctx.rows((await req("GET", "/assets/categories")).body);
      const category = categories[0];
      check("setup: there is an asset category to register against", Boolean(category?.id), JSON.stringify(category).slice(0, 200));
      if (!category?.id) return;
      const controlAccountId = category.accumulatedDepreciationAccountId as string | null;
      check("setup: the category names an accumulated-depreciation control account", Boolean(controlAccountId), JSON.stringify(category).slice(0, 200));
      if (!controlAccountId) return;

      const glBalance = async () => n((await req("GET", `/gl/accounts/${controlAccountId}/ledger`)).body?.balance?.balance);
      const controlBefore = await glBalance();

      const created = await req("POST", "/assets", {
        id: "SCN-D275-ASSET-1",
        code: "SCN-D275-FA-1",
        nameAr: "أصل اختبار عكس الإهلاك",
        categoryId: category.id,
        acquisitionDate: "2026-01-01",
        acquisitionCost: "12000.00",
        scope: "general",
      });
      check("setup: the asset registers", created.status === 201, JSON.stringify(created.body).slice(0, 200));

      const run1 = await req("POST", "/assets/depreciation/runs", { period: "2026-11" });
      const run1Id = run1.body?.id;
      check(
        "setup: run1 (2026-11) computes and includes the new asset",
        run1.status === 201 && (run1.body?.lines ?? []).some((l: any) => l.assetId === "SCN-D275-ASSET-1"),
        JSON.stringify(run1.body).slice(0, 250),
      );
      const posted1 = await req("POST", `/assets/depreciation/runs/${run1Id}/post`, {});
      check("setup: run1 posts", posted1.status === 200, JSON.stringify(posted1.body).slice(0, 200));

      const run2 = await req("POST", "/assets/depreciation/runs", { period: "2026-12" });
      const run2Id = run2.body?.id;
      const posted2 = await req("POST", `/assets/depreciation/runs/${run2Id}/post`, {});
      check("setup: run2 (2026-12) posts", posted2.status === 200, JSON.stringify(posted2.body).slice(0, 200));

      const afterRuns = (await req("GET", "/assets/SCN-D275-ASSET-1")).body;
      const accumulatedAfterRuns = n(afterRuns?.accumulatedDepreciation);
      check("setup: two runs raised the asset's accumulated depreciation", accumulatedAfterRuns > 0, JSON.stringify(afterRuns).slice(0, 200));

      // The category's control account is shared by every seeded asset in it,
      // not just this scenario's own — so the cross-check is against the two
      // runs' OWN reported totals (every asset each run touched), not this
      // one asset's figure alone.
      const postedTotal = n(posted1.body?.totalAmount) + n(posted2.body?.totalAmount);
      const controlAfterRuns = await glBalance();
      checkEq(
        "the accumulated-depreciation control account moved by exactly what the two posted runs' own totals show (a credit-natural account reads negative)",
        controlAfterRuns - controlBefore,
        -postedTotal,
        0.000001,
      );

      const blockedReverse = await req("POST", `/assets/depreciation/runs/${run1Id}/reverse`, { date: "2026-12-31" });
      check(
        "D275: the OLDER run cannot be reversed while the later run (2026-12) still stands",
        blockedReverse.status === 422 &&
          blockedReverse.body?.error === "LATER_DEPRECIATION_RUN_EXISTS" &&
          typeof blockedReverse.body?.messageEn === "string" &&
          blockedReverse.body.messageEn.length > 0,
        JSON.stringify(blockedReverse.body).slice(0, 250),
      );
      check(
        "and nothing moved for the refused reversal — run1 is still posted",
        (await req("GET", `/assets/depreciation/runs/${run1Id}`)).body?.status === "posted",
      );

      const tooEarly = await req("POST", `/assets/depreciation/runs/${run2Id}/reverse`, { date: "2026-01-01" });
      check(
        "D275: a reversal dated before the run's own day is refused, bilingually",
        tooEarly.status === 422 &&
          tooEarly.body?.error === "REVERSAL_DATE_BEFORE_ORIGINAL" &&
          typeof tooEarly.body?.messageEn === "string" &&
          tooEarly.body.messageEn.length > 0,
        JSON.stringify(tooEarly.body).slice(0, 250),
      );
      check(
        "and nothing posted for the refused reversal — run2 is still posted",
        (await req("GET", `/assets/depreciation/runs/${run2Id}`)).body?.status === "posted",
      );

      // Reverse newest-first, each dated explicitly at its own period-end day
      // — "no date defaults to today" is proved on its own, isolated clock in
      // the domain and route tests; this shared demo tenant's "today" (the
      // real wall clock) sits mid-year, BEFORE these two runs' own November/
      // December dates, so a bare {} here would legitimately trip the
      // date-before-original guard this same scenario just proved above.
      const reversed2 = await req("POST", `/assets/depreciation/runs/${run2Id}/reverse`, { date: "2026-12-31" });
      check(
        "D275: reversing the latest run succeeds now that nothing later stands",
        reversed2.status === 200 && reversed2.body?.status === "cancelled",
        JSON.stringify(reversed2.body).slice(0, 200),
      );
      const entry2 = await req("GET", `/gl/journal-entries/DEP-JE:${run2Id}`);
      const reversalEntry2 = await req("GET", `/gl/journal-entries/${entry2.body?.reversedByEntryId}`);
      check(
        "D275: the reversal posts on the date the caller sent",
        reversalEntry2.body?.date === "2026-12-31",
        JSON.stringify({ reversal: reversalEntry2.body?.date }),
      );

      // With the later run gone, the earlier one may be reversed too.
      const reversed1 = await req("POST", `/assets/depreciation/runs/${run1Id}/reverse`, { date: "2026-12-31" });
      check(
        "D275: after the later run is reversed, the earlier run may be reversed too",
        reversed1.status === 200 && reversed1.body?.status === "cancelled",
        JSON.stringify(reversed1.body).slice(0, 200),
      );

      const assetAfterReversal = (await req("GET", "/assets/SCN-D275-ASSET-1")).body;
      check(
        "D275: the asset's accumulated depreciation is back to exactly zero",
        assetAfterReversal?.accumulatedDepreciation === "0.000000",
        JSON.stringify(assetAfterReversal).slice(0, 200),
      );

      const controlAfterReversal = await glBalance();
      checkEq(
        "D275: the accumulated-depreciation control account ties back to exactly where it started",
        controlAfterReversal,
        controlBefore,
        0.000001,
      );
    },
  );
}
