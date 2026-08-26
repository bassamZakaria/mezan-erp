import type { Ctx, Res } from "./harness.js";

/**
 * Executable checks for the shell — docs/scenarios/08-shell-dashboard-reports.md.
 *
 * What this module CAN prove, driving the real routes in-process: every
 * report's arithmetic and its validation contract, the dashboard's KPIs
 * against the reports that back them, that warehouse scope narrows real
 * data, and that every `nav-config.ts` destination has a mounted backend
 * route behind it. What it CANNOT prove — layout, focus rings, RTL
 * mirroring, keyboard handling, command-bar behaviour, localStorage
 * persistence — stays manual; those scenarios (SHL-01 through SHL-20,
 * DSH-01/04/09/11/12, all HUB-*) are UI-only and not attempted here.
 */

interface ReportCheck {
  readonly id: string;
  readonly path: string;
  readonly totals: readonly string[];
  /**
   * Columns whose grand total is deliberately NOT the plain row sum, with the
   * figure it should be instead. The VAT return's two sides carry opposite
   * signs, so summing its tax column across both is meaningless — the number
   * the dashboard read as "VAT due" while the return said refundable.
   */
  readonly netTotals?: Readonly<Record<string, (rows: readonly any[], n: (v: unknown) => number) => number>>;
  readonly invalid?: { readonly qs: string; readonly field: string };
}

const OPERATIONAL_REPORTS: readonly ReportCheck[] = [
  { id: "sales.by-period", path: "/reports/sales/by-period", totals: ["count", "gross", "discount", "tax", "net"], invalid: { qs: "?dateFrom=not-a-date", field: "dateFrom" } },
  { id: "sales.by-item", path: "/reports/sales/by-item", totals: ["qty", "revenue"], invalid: { qs: "?dateFrom=not-a-date", field: "dateFrom" } },
  { id: "sales.by-customer", path: "/reports/sales/by-customer", totals: ["count", "total", "outstanding"], invalid: { qs: "?dateFrom=not-a-date", field: "dateFrom" } },
  { id: "sales.by-salesperson", path: "/reports/sales/by-salesperson", totals: ["count", "total", "promotionDiscount", "outstanding"], invalid: { qs: "?dateFrom=not-a-date", field: "dateFrom" } },
  { id: "sales.top-products", path: "/reports/sales/top-products", totals: ["qty", "revenue"], invalid: { qs: "?limit=0", field: "limit" } },
  { id: "purchases.by-period", path: "/reports/purchases/by-period", totals: ["count", "gross", "tax", "net"], invalid: { qs: "?dateFrom=not-a-date", field: "dateFrom" } },
  { id: "purchases.by-supplier", path: "/reports/purchases/by-supplier", totals: ["count", "total", "outstanding"], invalid: { qs: "?dateFrom=not-a-date", field: "dateFrom" } },
  { id: "purchases.by-item", path: "/reports/purchases/by-item", totals: ["qty", "cost"], invalid: { qs: "?dateFrom=not-a-date", field: "dateFrom" } },
  { id: "inventory.stock-levels", path: "/reports/inventory/stock-levels", totals: ["onHand", "value"] },
  { id: "inventory.movement", path: "/reports/inventory/movement", totals: ["qty"], invalid: { qs: "?direction=SIDEWAYS", field: "direction" } },
  { id: "inventory.ledger", path: "/reports/inventory/ledger", totals: [] },
  { id: "inventory.valuation", path: "/reports/inventory/valuation", totals: ["onHand", "totalValue"] },
  { id: "inventory.aging", path: "/reports/inventory/aging", totals: ["qty", "totalValue"], invalid: { qs: "?bucket=INVALID", field: "bucket" } },
  { id: "inventory.expiring", path: "/reports/inventory/expiring", totals: ["qty", "totalValue"], invalid: { qs: "?window=INVALID", field: "window" } },
  { id: "inventory.slow-moving", path: "/reports/inventory/slow-moving", totals: ["onHand", "value"], invalid: { qs: "?severity=apocalyptic", field: "severity" } },
  { id: "inventory.drift", path: "/reports/inventory/drift", totals: ["valueDiff"], invalid: { qs: "?type=unknown", field: "type" } },
  { id: "manufacturing.make-vs-buy", path: "/reports/manufacturing/make-vs-buy", totals: [] },
  { id: "aging.customers", path: "/reports/aging/customers", totals: ["current", "d31to60", "d61to90", "d91to120", "over120", "total"], invalid: { qs: "?asOfDate=not-a-date", field: "asOfDate" } },
  { id: "aging.suppliers", path: "/reports/aging/suppliers", totals: ["current", "d31to60", "d61to90", "d91to120", "over120", "total"], invalid: { qs: "?asOfDate=not-a-date", field: "asOfDate" } },
  { id: "installments.overview", path: "/reports/installments/overview", totals: ["totalAmount", "remaining"] },
  { id: "installments.overdue", path: "/reports/installments/overdue", totals: ["amount", "remaining"], invalid: { qs: "?asOfDate=not-a-date", field: "asOfDate" } },
  { id: "field.van-sales", path: "/reports/field/van-sales", totals: ["loadedQty", "returnedQty", "dispatchedQty", "salesCash", "collectionsCash", "openingCashFloat", "expectedCash", "countedCash", "cashVariance"], invalid: { qs: "?dateFrom=not-a-date", field: "dateFrom" } },
];

const FINANCIAL_REPORTS: readonly ReportCheck[] = [
  { id: "accounting.trial-balance", path: "/financial-reports/trial-balance", totals: ["debit", "credit"], invalid: { qs: "?asOfDate=not-a-date", field: "asOfDate" } },
  { id: "accounting.income-statement", path: "/financial-reports/income-statement", totals: ["amount", "priorAmount", "variance"], invalid: { qs: "?periodFrom=not-a-date", field: "periodFrom" } },
  { id: "accounting.balance-sheet", path: "/financial-reports/balance-sheet", totals: ["amount"], invalid: { qs: "?asOfDate=not-a-date", field: "asOfDate" } },
  { id: "accounting.cash-flow", path: "/financial-reports/cash-flow", totals: ["amount", "priorAmount", "variance"], invalid: { qs: "?periodFrom=not-a-date", field: "periodFrom" } },
  {
    id: "accounting.vat-return",
    path: "/financial-reports/vat-return",
    totals: ["base", "tax"],
    netTotals: {
      base: (rs, n) => rs.filter((r) => r.side === "output").reduce((s, r) => s + n(r.base), 0) - rs.filter((r) => r.side === "input").reduce((s, r) => s + n(r.base), 0),
      tax: (rs, n) => rs.filter((r) => r.side === "output").reduce((s, r) => s + n(r.tax), 0) - rs.filter((r) => r.side === "input").reduce((s, r) => s + n(r.tax), 0),
    },
    invalid: { qs: "?periodFrom=not-a-date", field: "periodFrom" },
  },
  { id: "accounting.general-ledger", path: "/financial-reports/general-ledger", totals: ["debit", "credit"], invalid: { qs: "?periodFrom=not-a-date", field: "periodFrom" } },
  { id: "accounting.account-ledger", path: "/financial-reports/account-ledger", totals: ["debit", "credit"], invalid: { qs: "?accountId=ACCT-DOES-NOT-EXIST", field: "accountId" } },
];

/**
 * `nav-config.ts`'s ~101 routable entries mapped to the ONE primary GET
 * endpoint each screen fetches on load. "Responds" here means the route is
 * mounted and handles the request — status 404 (or 5xx) is the failure this
 * catches; a 200/400/403 all prove the backend exists behind the nav click.
 */
const NAV_ENDPOINTS: readonly (readonly [string, string])[] = [
  ["dashboard", "/dashboard/summary"],
  ["approvals", "/workflow/requests/pending"],
  ["sales-hub", "/sales-invoices"],
  ["customers", "/customers"],
  ["quotes", "/sales-quotes"],
  ["sales-invoices", "/sales-invoices"],
  ["sales-returns", "/sales-returns"],
  ["price-lists", "/price-lists"],
  ["promotions", "/promotions"],
  ["purchases-hub", "/purchases/orders"],
  ["vendors", "/suppliers"],
  ["rfqs", "/rfqs"],
  ["purchase-orders", "/purchases/orders"],
  ["goods-receipts", "/purchases/receipts"],
  ["purchase-invoices", "/purchases/invoices"],
  ["purchase-returns", "/purchase-returns"],
  ["landed-costs", "/landed-costs"],
  ["inventory-hub", "/items"],
  ["items", "/items"],
  ["stock-balance", "/inventory/stock-balance"],
  ["stock-transfers", "/inventory/stock-transfers"],
  ["stock-adjustments", "/inventory/stock-adjustments"],
  ["physical-counts", "/inventory/physical-counts"],
  ["configurable-products", "/manufacturing/configurable-products"],
  ["product-templates", "/inventory/product-templates"],
  ["item-specifications", "/item-specifications"],
  ["labels", "/label-layouts"],
  ["writedown-runs", "/inventory/writedown-runs"],
  ["manufacturing-hub", "/manufacturing/dashboard"],
  ["production-dashboard", "/manufacturing/dashboard"],
  ["work-orders", "/manufacturing/work-orders"],
  ["boms", "/manufacturing/boms"],
  ["custom-manufacturing", "/manufacturing/config-instances"],
  ["accounting-hub", "/accounts"],
  ["coa", "/accounts"],
  ["cost-centers", "/cost-centers"],
  ["cost-center-pl", "/cost-center-pl"],
  ["journals", "/gl/journal-entries"],
  ["fiscal-periods", "/fiscal-periods"],
  ["taxes", "/tax-rates"],
  ["exchange-rates", "/exchange-rates"],
  ["reconciliation", "/reconciliation"],
  ["eta", "/eta/submissions"],
  ["trial-balance-report", "/financial-reports/trial-balance"],
  ["financial-reports", "/financial-reports/trial-balance"],
  ["treasury-hub", "/treasury-accounts"],
  ["treasury-accounts", "/treasury-accounts"],
  ["treasury-vouchers", "/vouchers"],
  ["bank-reconciliation", "/bank-statements"],
  ["cheques", "/cheques"],
  ["crm-hub", "/crm/leads"],
  ["leads", "/crm/leads"],
  ["opportunities", "/crm/opportunities"],
  ["pipeline", "/crm/opportunities"],
  ["pipeline-stages", "/crm/pipeline-stages"],
  ["crm-activities", "/crm/activities"],
  ["hr-dashboard", "/hr/dashboard"],
  ["employees", "/hr/employees"],
  ["departments", "/hr/departments"],
  ["job-titles", "/hr/job-titles"],
  ["contracts", "/hr/contracts"],
  ["holidays", "/hr/holidays"],
  ["attendance", "/hr/attendance"],
  ["payroll", "/hr/payroll/runs"],
  ["advances", "/hr/advances"],
  ["leave-requests", "/hr/leave-requests"],
  ["leave-balances", "/hr/leave-balances"],
  ["leave-accrual-batches", "/hr/leave-accrual-batches"],
  ["leave-policies", "/hr/leave-policies"],
  ["my-leave", "/hr/leave-requests/me"],
  ["projects", "/projects"],
  ["assets-hub", "/assets"],
  ["asset-register", "/assets"],
  ["depreciation-runs", "/assets/depreciation/runs"],
  ["asset-categories", "/assets/categories"],
  ["van-trips", "/field/van-trips"],
  ["installment-plans", "/installments/plans"],
  ["installment-follow-ups", "/installments/follow-ups"],
  ["report-sales-by-period", "/reports/sales/by-period"],
  ["report-sales-by-item", "/reports/sales/by-item"],
  ["report-sales-by-customer", "/reports/sales/by-customer"],
  ["report-sales-by-salesperson", "/reports/sales/by-salesperson"],
  ["report-sales-top-products", "/reports/sales/top-products"],
  ["report-purchases-by-period", "/reports/purchases/by-period"],
  ["report-purchases-by-supplier", "/reports/purchases/by-supplier"],
  ["report-purchases-by-item", "/reports/purchases/by-item"],
  ["report-inventory-stock-levels", "/reports/inventory/stock-levels"],
  ["report-inventory-movement", "/reports/inventory/movement"],
  ["report-inventory-ledger", "/reports/inventory/ledger"],
  ["report-inventory-valuation", "/reports/inventory/valuation"],
  ["report-inventory-aging", "/reports/inventory/aging"],
  ["report-inventory-expiring", "/reports/inventory/expiring"],
  ["report-inventory-slow-moving", "/reports/inventory/slow-moving"],
  ["report-inventory-drift", "/reports/inventory/drift"],
  ["report-aging-customers", "/reports/aging/customers"],
  ["report-aging-suppliers", "/reports/aging/suppliers"],
  ["report-installments-overview", "/reports/installments/overview"],
  ["report-installments-overdue", "/reports/installments/overdue"],
  ["report-van-sales", "/reports/field/van-sales"],
  ["report-make-vs-buy", "/reports/manufacturing/make-vs-buy"],
  ["settings-general", "/settings"],
  ["settings-branches", "/branches"],
  ["settings-warehouses", "/warehouses"],
  ["settings-print", "/print-template-config"],
  ["notification-rules", "/notification-rules"],
  ["settings-data-migration", "/data-migration/status"],
  ["settings-workflow", "/workflow/configs"],
  ["settings-sequences", "/sequences"],
  ["settings-barcode", "/barcode-config"],
  ["settings-profile", "/profile"],
  ["settings-api-keys", "/api-keys"],
  ["settings-webhooks", "/webhooks"],
  ["audit", "/audit"],
  ["users", "/users"],
  ["roles", "/roles"],
  ["status", "/health"],
];

export async function run(ctx: Ctx): Promise<void> {
  const { req, rows, n, check, checkEq, scenario } = ctx;

  function sumRows(list: readonly any[], key: string): number {
    return list.reduce((sum: number, row: any) => sum + n(row[key]), 0);
  }

  async function checkReport(spec: ReportCheck): Promise<void> {
    await scenario(`SCN-RPT-${spec.id}`, async () => {
      const res = await req("GET", spec.path);
      check("responds", res.ok, `status ${res.status} — ${JSON.stringify(res.body).slice(0, 200)}`);
      if (res.ok) {
        const rs = rows(res.body);
        if (spec.totals.length === 0) {
          check(
            "no total:true column, so grandTotals carries no keys (no total row expected)",
            Object.keys(res.body?.grandTotals ?? {}).length === 0,
            JSON.stringify(res.body?.grandTotals),
          );
        }
        for (const key of spec.totals) {
          const net = spec.netTotals?.[key];
          if (net) checkEq(`grand total "${key}" = output − input, not the meaningless row sum`, n(res.body?.grandTotals?.[key]), net(rs, n));
          else checkEq(`grand total "${key}" = sum of its rows`, n(res.body?.grandTotals?.[key]), sumRows(rs, key));
        }
      }
      if (spec.invalid) {
        const bad = await req("GET", `${spec.path}${spec.invalid.qs}`);
        check("invalid param rejected with 400 (server-side)", bad.status === 400, `status ${bad.status} — ${JSON.stringify(bad.body).slice(0, 200)}`);
        const errs: any[] = Array.isArray(bad.body?.errors) ? bad.body.errors : [];
        check(
          `rejection names field "${spec.invalid.field}" (D14 is a client-side swallow — the server itself validates)`,
          errs.some((e) => e?.field === spec.invalid!.field),
          JSON.stringify(errs),
        );
      }
    });
  }

  for (const spec of OPERATIONAL_REPORTS) await checkReport(spec);
  for (const spec of FINANCIAL_REPORTS) await checkReport(spec);

  // RPT-23 — Cost-Center P&L: bespoke `DocumentList` screen, not `<ReportRunner>`.
  // No `ReportDefinition`/zod schema behind it at all, so unlike the 30 reports
  // above (all of which validate server-side regardless of D14's client bug),
  // this one route genuinely has no server-side rejection to find.
  await scenario("SCN-RPT-cost-center-pl", async () => {
    const res = await req("GET", "/cost-center-pl");
    check("responds", res.ok, `status ${res.status}`);
    if (res.ok) {
      const rs: any[] = Array.isArray(res.body?.rows) ? res.body.rows : [];
      checkEq("totals.revenue = sum of rows", n(res.body?.totals?.revenue), sumRows(rs, "revenue"));
      checkEq("totals.expense = sum of rows", n(res.body?.totals?.expense), sumRows(rs, "expense"));
      checkEq("totals.profit = sum of rows", n(res.body?.totals?.profit), sumRows(rs, "profit"));
    }
    const bad = await req("GET", "/cost-center-pl?fromDate=not-a-date");
    check(
      "unlike the 30 ReportDefinition reports, a malformed date here is NOT rejected — no zod schema behind this bespoke route at all",
      bad.status !== 400,
      `status ${bad.status}`,
    );
  });

  // RPT-24 dual-entry-point: the standalone "ميزان المراجعة" nav item and the
  // "التقارير المالية" tab both claim to run the same report. reports-routes.ts
  // ALSO exposes a (client-unused) duplicate at /reports/accounting/trial-balance
  // — confirm both server copies agree for the same asOfDate.
  await scenario("SCN-RPT-24-dual-entry-point", async () => {
    const asOfDate = "2026-08-22";
    const standalone = await req("GET", `/financial-reports/trial-balance?asOfDate=${asOfDate}`);
    const duplicate = await req("GET", `/reports/accounting/trial-balance?asOfDate=${asOfDate}`);
    check("standalone /financial-reports/trial-balance responds", standalone.ok, `status ${standalone.status}`);
    check("duplicate /reports/accounting/trial-balance responds", duplicate.ok, `status ${duplicate.status}`);
    if (standalone.ok && duplicate.ok) {
      checkEq("both trial-balance server copies agree on debit total", n(standalone.body?.grandTotals?.debit), n(duplicate.body?.grandTotals?.debit));
      checkEq("both trial-balance server copies agree on credit total", n(standalone.body?.grandTotals?.credit), n(duplicate.body?.grandTotals?.credit));
    }
    check(
      "reconciliation block: مدين = دائن",
      standalone.ok ? Boolean(standalone.body?.reconciliation?.withinTolerance) : false,
      JSON.stringify(standalone.body?.reconciliation),
    );
  });

  // RPT-26 — balance sheet declares showGrandTotal:false; its own reconciliation
  // (الأصول = الالتزامات + حقوق الملكية) is the number that matters, not a table total.
  await scenario("SCN-RPT-26-balance-sheet-reconciles", async () => {
    const res = await req("GET", "/financial-reports/balance-sheet");
    check("responds", res.ok, `status ${res.status}`);
    if (res.ok) {
      check("الأصول = الالتزامات + حقوق الملكية (reconciliation.withinTolerance)", Boolean(res.body?.reconciliation?.withinTolerance), JSON.stringify(res.body?.reconciliation));
    }
  });

  // RPT-27 — cash flow's own reconciliation: opening + net change = closing.
  await scenario("SCN-RPT-27-cash-flow-reconciles", async () => {
    const res = await req("GET", "/financial-reports/cash-flow");
    check("responds", res.ok, `status ${res.status}`);
    if (res.ok) {
      check("الرصيد الافتتاحي + صافي التغيير = الرصيد الختامي (reconciliation.withinTolerance)", Boolean(res.body?.reconciliation?.withinTolerance), JSON.stringify(res.body?.reconciliation));
    }
  });

  // RPT-29 general ledger / RPT-30 account ledger: مدين = دائن.
  await scenario("SCN-RPT-29-general-ledger-balances", async () => {
    const res = await req("GET", "/financial-reports/general-ledger");
    check("responds", res.ok, `status ${res.status}`);
    if (res.ok) check("مدين = دائن (reconciliation.withinTolerance)", Boolean(res.body?.reconciliation?.withinTolerance), JSON.stringify(res.body?.reconciliation));
  });

  await scenario("SCN-RPT-30-account-ledger-pre-selected", async () => {
    const res = await req("GET", "/financial-reports/account-ledger");
    check("runs against the server-pre-selected first postable account without an explicit accountId", res.ok, `status ${res.status}`);
    if (res.ok) {
      check("running balance reconciles (reconciliation.withinTolerance)", Boolean(res.body?.reconciliation?.withinTolerance), JSON.stringify(res.body?.reconciliation));
    }
  });

  // RPT-05 — sales.top-products: limit clamping and rankBy toggle.
  await scenario("SCN-RPT-05-top-products-limit-and-rank", async () => {
    const limited = await req("GET", "/reports/sales/top-products?limit=3");
    check("limit=3 caps row count at 3", limited.ok && rows(limited.body).length <= 3, `status ${limited.status} rows ${rows(limited.body).length}`);
    const byRevenue = await req("GET", "/reports/sales/top-products?rankBy=revenue");
    const byQty = await req("GET", "/reports/sales/top-products?rankBy=qty");
    check("both rankBy values respond", byRevenue.ok && byQty.ok, `status ${byRevenue.status}/${byQty.status}`);
    if (byRevenue.ok && byQty.ok) {
      const rev = rows(byRevenue.body);
      const qty = rows(byQty.body);
      const nonIncreasing = (list: readonly any[], key: string) => list.every((r, i) => i === 0 || n(list[i - 1][key]) >= n(r[key]) - 0.005);
      check("rankBy=revenue rows are sorted non-increasing by revenue", nonIncreasing(rev, "revenue"), JSON.stringify(rev.map((r: any) => r.revenue)));
      check("rankBy=qty rows are sorted non-increasing by qty", nonIncreasing(qty, "qty"), JSON.stringify(qty.map((r: any) => r.qty)));
    }
  });

  // RPT-20 — van sales: فرق النقدية per row = countedCash − expectedCash.
  await scenario("SCN-RPT-20-van-sales-cash-variance", async () => {
    const res = await req("GET", "/reports/field/van-sales");
    check("responds", res.ok, `status ${res.status}`);
    if (res.ok) {
      // Unsettled trips carry `cashVariance: null` (blank settlement columns,
      // per the report's own description) — countedCash is null too, so they
      // must be excluded rather than treated as a zero count.
      const settled = rows(res.body).filter((r: any) => r.cashVariance !== null && r.countedCash !== null);
      const computedVariance = settled.reduce((sum: number, r: any) => sum + (n(r.countedCash) - n(r.expectedCash)), 0);
      checkEq("Σ(countedCash − expectedCash) over SETTLED trips = فرق النقدية grand total", computedVariance, n(res.body?.grandTotals?.cashVariance));
    }
  });

  // RPT-16 / D4 — drift report type filter narrows rows; spurious rows are D4, not re-filed.
  await scenario("SCN-RPT-16-drift-type-filter", async () => {
    const all = await req("GET", "/reports/inventory/drift");
    const valueOnly = await req("GET", "/reports/inventory/drift?type=value");
    const qtyOnly = await req("GET", "/reports/inventory/drift?type=qty");
    check("all three type filters respond", all.ok && valueOnly.ok && qtyOnly.ok, `status ${all.status}/${valueOnly.status}/${qtyOnly.status}`);
    if (all.ok && valueOnly.ok && qtyOnly.ok) {
      check("type=value rows are a subset of the unfiltered set", rows(valueOnly.body).length <= rows(all.body).length, `${rows(valueOnly.body).length} vs ${rows(all.body).length}`);
      check("type=qty rows are a subset of the unfiltered set", rows(qtyOnly.body).length <= rows(all.body).length, `${rows(qtyOnly.body).length} vs ${rows(all.body).length}`);
      // D4: any row here may be spurious — occurredAt is stamped now() on
      // confirm, not the document date, so the replay can misorder a receipt
      // after the movement it funded. Not re-filed; see docs/defects.md.
    }
  });

  // --- Priority 3: scope actually filters -----------------------------

  await scenario("SCN-SHL-05-warehouse-scope-narrows-stock-balance", async () => {
    const all = await req("GET", "/inventory/stock-balance", undefined, { "x-warehouse-scope": "*" });
    const scoped = await req("GET", "/inventory/stock-balance", undefined, { "x-warehouse-scope": "WH-DEMO-2" });
    check("both respond", all.ok && scoped.ok, `status ${all.status}/${scoped.status}`);
    if (all.ok && scoped.ok) {
      const allRows = rows(all.body);
      const scopedRows = rows(scoped.body);
      check(
        "x-warehouse-scope: WH-DEMO-2 returns strictly fewer rows than * on /inventory/stock-balance (F8)",
        scopedRows.length < allRows.length,
        `* -> ${allRows.length} rows, WH-DEMO-2 -> ${scopedRows.length} rows`,
      );
    }
  });

  await scenario("SCN-SHL-05-warehouse-scope-narrows-reports", async () => {
    const allValuation = await req("GET", "/reports/inventory/valuation", undefined, { "x-warehouse-scope": "*" });
    const scopedValuation = await req("GET", "/reports/inventory/valuation", undefined, { "x-warehouse-scope": "WH-DEMO-2" });
    check("both respond", allValuation.ok && scopedValuation.ok, `status ${allValuation.status}/${scopedValuation.status}`);
    if (allValuation.ok && scopedValuation.ok) {
      check(
        "x-warehouse-scope: WH-DEMO-2 returns a smaller totalValue than * on /reports/inventory/valuation",
        n(scopedValuation.body?.grandTotals?.totalValue) < n(allValuation.body?.grandTotals?.totalValue),
        `* -> ${n(allValuation.body?.grandTotals?.totalValue)}, WH-DEMO-2 -> ${n(scopedValuation.body?.grandTotals?.totalValue)}`,
      );
    }

    const allLevels = await req("GET", "/reports/inventory/stock-levels", undefined, { "x-warehouse-scope": "*" });
    const scopedLevels = await req("GET", "/reports/inventory/stock-levels", undefined, { "x-warehouse-scope": "WH-DEMO-2" });
    check("both respond", allLevels.ok && scopedLevels.ok, `status ${allLevels.status}/${scopedLevels.status}`);
    if (allLevels.ok && scopedLevels.ok) {
      check(
        "x-warehouse-scope: WH-DEMO-2 returns fewer or equal rows than * on /reports/inventory/stock-levels",
        rows(scopedLevels.body).length <= rows(allLevels.body).length,
        `* -> ${rows(allLevels.body).length} rows, WH-DEMO-2 -> ${rows(scopedLevels.body).length} rows`,
      );
    }
  });

  await scenario("SCN-SHL-05-branch-scope-D7", async () => {
    const all = await req("GET", "/sales-invoices", undefined, { "x-branch-scope": "*" });
    const scoped = await req("GET", "/sales-invoices", undefined, { "x-branch-scope": "BR-MAIN" });
    check("both respond", all.ok && scoped.ok, `status ${all.status}/${scoped.status}`);
    if (all.ok && scoped.ok) {
      check(
        "D7 (open): x-branch-scope: BR-MAIN returns the SAME row count as * on /sales-invoices — no list route reads branchScope yet, and the tenant has one branch, so this is unprovable either way and asserted as current behaviour, not re-filed",
        rows(scoped.body).length === rows(all.body).length,
        `* -> ${rows(all.body).length} rows, BR-MAIN -> ${rows(scoped.body).length} rows`,
      );
    }
  });

  // --- Priority 2: the dashboard agrees with the reports it summarises -

  const today = new Date().toISOString().slice(0, 10);
  const thisYear = Number(today.slice(0, 4));
  const windows = {
    month: { from: `${today.slice(0, 7)}-01`, to: today },
    year: { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
    all: { from: "1900-01-01", to: `${thisYear + 50}-12-31` },
  } as const;

  await scenario("SCN-DSH-02-period-toggle-changes-figures", async () => {
    const rMonth = await req("GET", `/dashboard/summary?fromDate=${windows.month.from}&toDate=${windows.month.to}`);
    const rYear = await req("GET", `/dashboard/summary?fromDate=${windows.year.from}&toDate=${windows.year.to}`);
    const rAll = await req("GET", `/dashboard/summary?fromDate=${windows.all.from}&toDate=${windows.all.to}`);
    check("month/year/all windows all respond", rMonth.ok && rYear.ok && rAll.ok, `status ${rMonth.status}/${rYear.status}/${rAll.status}`);
    if (rMonth.ok && rYear.ok && rAll.ok) {
      const revM = n(rMonth.body?.gl?.revenue);
      const revY = n(rYear.body?.gl?.revenue);
      const revA = n(rAll.body?.gl?.revenue);
      check("widening the window from month to year never loses revenue", revY >= revM - 0.005, `month ${revM} -> year ${revY}`);
      check("widening the window from year to all-periods never loses revenue", revA >= revY - 0.005, `year ${revY} -> all ${revA}`);
    }
  });

  await scenario("SCN-DSH-03-kpi-reconciles-with-income-statement", async () => {
    const dash = await req("GET", `/dashboard/summary?fromDate=${windows.all.from}&toDate=${windows.all.to}`);
    const inc = await req("GET", `/financial-reports/income-statement?periodFrom=${windows.all.from}&periodTo=${windows.all.to}&compareTo=previous`);
    check("/dashboard/summary responds", dash.ok, `status ${dash.status}`);
    check("/financial-reports/income-statement responds", inc.ok, `status ${inc.status}`);
    if (dash.ok && inc.ok) {
      const incRows = rows(inc.body);
      /**
       * Summed SIGNED, then negated for the expense side — not `Math.abs`.
       * The report renders a debit negative, and an expense account is allowed
       * to carry a credit balance: 5075 تسويات مخزون أخرى is a variance account
       * that is debited on a shortfall and CREDITED on an overage, so a stock
       * gain is a negative expense. Taking magnitudes turned that credit into a
       * second debit and put the two figures 2× the overage apart, which read
       * as a dashboard defect and was an arithmetic error in this assertion.
       */
      const revenue = incRows.filter((r: any) => r.sectionKey === "revenue").reduce((sum: number, r: any) => sum + n(r.amount), 0);
      const expenses = -incRows.filter((r: any) => r.sectionKey !== "revenue").reduce((sum: number, r: any) => sum + n(r.amount), 0);
      checkEq("dashboard gl.revenue = income-statement revenue section", n(dash.body?.gl?.revenue), revenue);
      checkEq("dashboard gl.expenses = income-statement non-revenue sections (also DSH-07's expense-donut total)", n(dash.body?.gl?.expenses), expenses);
      checkEq("dashboard gl.netProfit = revenue - expenses", n(dash.body?.gl?.netProfit), revenue - expenses);
    }

    const aging = await req("GET", `/reports/aging/customers?asOfDate=${windows.all.to}`);
    check("/reports/aging/customers responds", aging.ok, `status ${aging.status}`);
    if (dash.ok && aging.ok) {
      checkEq(
        "dashboard gl.receivables = aging.customers grand total (DSH-03 vs RPT-18) — one meaning of \"receivables\" across the tile and the report (docs/defects.md D37 — the regression guard)",
        n(dash.body?.gl?.receivables),
        n(aging.body?.grandTotals?.total),
      );
    }
  });

  await scenario("SCN-DSH-06-aging-matrix-source", async () => {
    const customers = await req("GET", `/reports/aging/customers?asOfDate=${windows.all.to}`);
    const suppliers = await req("GET", `/reports/aging/suppliers?asOfDate=${windows.all.to}`);
    check(
      "the dashboard's aging matrix is fed directly from these two reports' own grandTotals — no client transform beyond bucket ordering; both respond",
      customers.ok && suppliers.ok,
      `status ${customers.status}/${suppliers.status}`,
    );
  });

  await scenario("SCN-DSH-05-vat-due-uses-wrong-figure", async () => {
    const res = await req("GET", `/financial-reports/vat-return?periodFrom=${windows.all.from}&periodTo=${windows.all.to}`);
    check("responds", res.ok, `status ${res.status}`);
    if (res.ok) {
      const rs = rows(res.body);
      const outputTax = rs.filter((r: any) => r.side === "output").reduce((sum: number, r: any) => sum + n(r.tax), 0);
      const inputTax = rs.filter((r: any) => r.side === "input").reduce((sum: number, r: any) => sum + n(r.tax), 0);
      const netPayable = outputTax - inputTax;
      const dashboardTaxDue = n(res.body?.grandTotals?.tax);
      checkEq(
        "candidate new defect, not in docs/defects.md (report, do not silently accept): DSH-05's tax-due row reads vat.data.grandTotals.tax — the engine sums BOTH sides' tax columns together (output+input) with no sign convention between groups — while RPT-28's own renderSummary calls vatNetPayable(rows) = output − input; the two should agree",
        dashboardTaxDue,
        netPayable,
      );
    }
  });

  // --- Priority 4: every nav destination has a live backend ------------

  await scenario("SCN-NAV-liveness", async () => {
    check(`covers ${NAV_ENDPOINTS.length} of apps/web/src/nav-config.ts's ~101 routable entries (incl. dashboard)`, NAV_ENDPOINTS.length >= 100, `${NAV_ENDPOINTS.length}`);
    for (const [key, path] of NAV_ENDPOINTS) {
      const res = await req("GET", path);
      check(`"${key}" -> GET ${path} is mounted (not 404) and did not crash (not 5xx)`, res.status !== 404 && res.status < 500, `status ${res.status}`);
    }
    // revaluation has no GET route at all (POST /preview, POST /post only) —
    // a bare GET on its own mount 404s even though the route exists, so its
    // liveness has to be proven through the one verb it actually exposes.
    const revaluation: Res = await req("POST", "/revaluation/preview", {});
    check('"revaluation" -> POST /revaluation/preview is mounted (not 404)', revaluation.status !== 404, `status ${revaluation.status}`);
  });

  // --- D7: the BRANCH selector narrows, the way the warehouse one does ----
  //
  // Unprovable on the seeded tenant alone: it ships one branch, so "narrowed"
  // and "everything" are the same set. A second branch that owns nothing makes
  // the difference visible.

  await scenario("SCN-SCOPE-branch — x-branch-scope narrows every branch-owned list (D7)", async () => {
    const created = await req("POST", "/branches", {
      id: "BR-SCN-2", code: "BR-SCN-2", name: "فرع اختبار النطاق", parentBranchId: null, isMain: false, active: true,
    });
    check("a second branch is created for the scoping proof", created.status === 201, `${created.status}: ${JSON.stringify(created.body)}`);

    const branchOwned = [
      "/sales-invoices", "/sales-quotes", "/treasury-accounts", "/warehouses",
      "/vouchers", "/hr/employees", "/purchases/orders", "/purchases/invoices",
      "/cheques", "/rfqs",
    ];
    for (const path of branchOwned) {
      const all = rows((await req("GET", path, undefined, { "x-branch-scope": "*" })).body);
      const scoped = rows((await req("GET", path, undefined, { "x-branch-scope": "BR-SCN-2" })).body);
      check(
        `x-branch-scope=BR-SCN-2 narrows ${path} to the empty branch`,
        all.length > 0 && scoped.length === 0,
        `all=${all.length} BR-SCN-2=${scoped.length}`,
      );
      const mainScoped = rows((await req("GET", path, undefined, { "x-branch-scope": "BR-MAIN" })).body);
      check(`scoping ${path} to BR-MAIN still shows its own rows`, mainScoped.length > 0, `BR-MAIN=${mainScoped.length}`);
    }

    // A row with no branch at all is not attributable, so it must stay visible
    // rather than silently vanish under a narrowed scope.
    const centersAll = rows((await req("GET", "/cost-centers", undefined, { "x-branch-scope": "*" })).body);
    const centersScoped = rows((await req("GET", "/cost-centers", undefined, { "x-branch-scope": "BR-SCN-2" })).body);
    check(
      "a branchless cost centre stays visible under a narrowed branch scope",
      centersScoped.length > 0 && centersScoped.length < centersAll.length && centersScoped.every((cc: any) => cc.branchId == null),
      `all=${centersAll.length} scoped=${centersScoped.length}`,
    );
  });
}
