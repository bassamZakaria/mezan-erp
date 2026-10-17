import type { ScenarioFragment } from "./fragments.js";

const BRANCH = "BR-MAIN";
const WH = "WH-MAIN";
const CUSTOMER = "CUST-DEMO-1";
const ITEM = "SCN-PF-ITEM";
const INVOICE = "SCN-PF-INV";
const AR = "1105";
const REVENUE = "4100";
const COGS = "5100";
const OUTPUT_TAX = "2200";
const PRICE_FLOOR_ACTION = "SALES_PRICE_FLOOR_OVERRIDE";
const CLERK = { "x-user-id": "SCN-PF-CLERK", "x-permissions": "sales.invoice.create,sales.invoice.confirm,sales.invoice.view", "x-role-codes": "SALES_REP" };
const MANAGER = { "x-user-id": "SCN-PF-MANAGER", "x-permissions": "workflow.view,workflow.approve,workflow.reject", "x-role-codes": "BRANCH_MANAGER" };

/**
 * Price floor (ENH-E2-08) on an item of its own (WAC 50.00), sold 2 × 70.00
 * against a floor of 80.00. A block rule refuses the confirm outright; turned
 * off, an approval rule holds the same invoice بانتظار الموافقة for a clerk,
 * and only the seeded branch-manager chain's approval posts it — leaving one override row naming
 * who asked and who approved.
 */
export const scenario: ScenarioFragment = {
  smokePaths: ["/pricing-guard/rules", "/pricing-guard/overrides"],

  async run(ctx) {
    const { scenario: it, req, rows, n, check, checkEq, today } = ctx;
    const same = (label: string, actual: unknown, expected: unknown) => check(label, actual === expected, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
    const gl = async (code: string) => n((await req("GET", `/gl/accounts/${code}/ledger`)).body?.balance?.balance);
    const books = async () => ({ ar: await gl(AR), revenue: await gl(REVENUE), cogs: await gl(COGS), tax: await gl(OUTPUT_TAX) });
    const onHand = async () => n((await req("GET", `/inventory/balance?itemId=${ITEM}&warehouseId=${WH}`)).body?.onHand);
    const rule = (nameAr: string, mode: string) =>
      req("POST", "/pricing-guard/rules", { nameAr, itemId: ITEM, categoryId: null, customerCategory: null, floorPrice: "80", minMarginPercent: null, mode, note: null });

    await it("price floor · a block rule refuses the confirm; an approval rule holds it until the chain approves, then it posts and leaves an override row", async () => {
      checkEq("an item is created", (await req("POST", "/items", { id: ITEM, code: "SCN-PF", nameAr: "صنف بحد أدنى للسعر", type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: REVENUE, cogsAccountId: COGS, inventoryAccountId: "1200" })).status, 201);
      await req("POST", "/inventory/stock-adjustments/draft", { id: "SCN-PF-OPEN", date: today, lines: [{ itemId: ITEM, warehouseId: WH, reason: "INITIAL_STOCK", direction: "IN", qty: "10", unitCost: "50" }] });
      check("and stocked at 50.00", (await req("POST", "/inventory/stock-adjustments/SCN-PF-OPEN/confirm", {})).ok);

      const blockRule = await rule("حد أدنى صارم", "block");
      checkEq("a block-mode floor of 80.00 is set on the item", blockRule.status, 201);
      let approvalRuleId: string | null = null;
      try {
        const draft = await req("POST", "/sales-invoices", {
          id: INVOICE,
          date: today,
          dueDate: today,
          customerId: CUSTOMER,
          customerNameAr: "عميل الحد الأدنى",
          warehouseId: WH,
          branchId: BRANCH,
          currency: "EGP",
          arAccountId: AR,
          taxAccountId: OUTPUT_TAX,
          lines: [{ lineId: `${INVOICE}-L1`, itemId: ITEM, itemNameAr: "صنف بحد أدنى للسعر", isStock: true, qty: "2", unitPrice: "70", taxRatePercent: 14, revenueAccountId: REVENUE, cogsAccountId: COGS, inventoryAccountId: "1200" }],
        });
        checkEq("an invoice below the floor is drafted", draft.status, 201);

        const preview = await req("POST", "/pricing-guard/evaluate", {
          docType: "sales_invoice", date: today, customerId: CUSTOMER, branchId: BRANCH, warehouseId: WH, currency: "EGP",
          discount: { type: "percent", percent: 0 }, taxInclusive: false,
          lines: [{ lineId: "L1", itemId: ITEM, qty: "2", unitPrice: "70", taxRatePercent: 14 }],
        });
        same("the preview already says blocked", preview.body?.outcome, "blocked");

        const before = await books();
        const blocked = await req("POST", `/sales-invoices/${INVOICE}/confirm`, {});
        checkEq("confirming it under the block rule is refused", blocked.status, 422);
        same("as blocked by the price guard", blocked.body?.error, "PRICING_GUARD_BLOCKED");
        check("in Arabic and English", /[؀-ۿ]/.test(String(blocked.body?.message)) && typeof blocked.body?.messageEn === "string", JSON.stringify(blocked.body).slice(0, 200));
        const blockedLine = blocked.body?.lines?.[0];
        check("naming the line and the floor it broke", JSON.stringify(blockedLine ?? {}).includes(`${INVOICE}-L1`), JSON.stringify(blocked.body?.lines));
        same("the invoice stays a draft", (await req("GET", `/sales-invoices/${INVOICE}`)).body?.status, "draft");
        checkEq("no stock left", await onHand(), 10);
        checkEq("and AR did not move", (await books()).ar - before.ar, 0);

        checkEq("the block rule is switched off", (await req("POST", `/pricing-guard/rules/${blockRule.body?.id}/status`, { status: "inactive" })).status, 200);
        const approvalRule = await rule("حد أدنى بموافقة", "approval");
        checkEq("an approval-mode floor of 80.00 takes its place", approvalRule.status, 201);
        approvalRuleId = approvalRule.body?.id ?? null;

        const chain = rows((await req("GET", "/workflow/configs")).body).find((c: any) => c.actionType === PRICE_FLOOR_ACTION);
        check("the tenant routes price-floor overrides to a branch manager", chain?.steps?.[0]?.role === "BRANCH_MANAGER", JSON.stringify(chain));

        const held = await req("POST", `/sales-invoices/${INVOICE}/confirm`, {}, CLERK);
        check("the clerk's confirm is held for approval", held.status === 200 && held.body?.held === true, `status ${held.status} ${JSON.stringify(held.body).slice(0, 250)}`);
        const pending = (await req("GET", `/sales-invoices/${INVOICE}`)).body;
        same("the invoice waits بانتظار الموافقة", pending?.status, "pending");
        const requestId: string = pending?.workflowRequestId;
        same("on the price-floor request", requestId, `${INVOICE}:price-floor`);
        const heldBooks = await books();
        checkEq("holding it posted no receivable", heldBooks.ar - before.ar, 0);
        checkEq("no revenue", heldBooks.revenue - before.revenue, 0);
        checkEq("and moved no stock", await onHand(), 10);

        const selfDecision = await req("POST", `/workflow/requests/${encodeURIComponent(requestId)}/decide`, { decision: "approve" }, CLERK);
        check("the clerk cannot approve their own request", selfDecision.status === 403, `status ${selfDecision.status}`);

        const approved = await req("POST", `/workflow/requests/${encodeURIComponent(requestId)}/decide`, { decision: "approve" }, MANAGER);
        check("the chain's manager approves it", approved.status === 200 && approved.body?.status === "approved", `status ${approved.status} ${JSON.stringify(approved.body).slice(0, 250)}`);
        const posted = (await req("GET", `/sales-invoices/${INVOICE}`)).body;
        same("the approval posts the invoice", posted?.status, "confirmed");
        const after = await books();
        checkEq("AR rises by 2 × 70 + 14% VAT", after.ar - before.ar, 159.6);
        checkEq("revenue is credited 140.00", before.revenue - after.revenue, 140);
        checkEq("output VAT 19.60", before.tax - after.tax, 19.6);
        checkEq("COGS charges 2 × WAC 50", after.cogs - before.cogs, 100);
        checkEq("and 2 units leave", await onHand(), 8);

        const overrides = rows((await req("GET", `/pricing-guard/overrides?itemId=${ITEM}`)).body).filter((r: any) => r.docId === INVOICE);
        checkEq("exactly one override row is recorded", overrides.length, 1);
        const row = overrides[0];
        same("as approved by the chain", row?.kind, "approved_by_chain");
        same("on the request that held it", row?.approvalRequestId, requestId);
        same("asked for by the clerk", row?.submittedBy, "SCN-PF-CLERK");
        check("approved by the manager", (row?.approvedBy ?? []).includes("SCN-PF-MANAGER"), JSON.stringify(row?.approvedBy));
        checkEq("at the net unit price sold", n(row?.netUnitPrice), 70);
        checkEq("for 2 units", n(row?.baseQty), 2);
        check("breaking the 80.00 floor", row?.breaches?.[0]?.kind === "below_floor" && n(row?.breaches?.[0]?.floorPrice) === 80, JSON.stringify(row?.breaches));
        checkEq("with the unit cost it was judged against", n(row?.unitCost), 50);
      } finally {
        if (approvalRuleId) await req("POST", `/pricing-guard/rules/${approvalRuleId}/status`, { status: "inactive" });
        if (blockRule.body?.id) await req("POST", `/pricing-guard/rules/${blockRule.body.id}/status`, { status: "inactive" });
      }
    });
  },
};
