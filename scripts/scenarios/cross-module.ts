import type { Ctx } from "./harness.js";

/**
 * Executable checks for the CROSS-MODULE money trails — docs/scenarios/09-cross-module.md.
 *
 * Every other file in this directory proves one module behaves. This one proves
 * the modules agree with each other: that selling puts money in the treasury the
 * treasury screen reads, that buying takes it out of the same one, and that no
 * document anywhere leaves the books unbalanced on the way.
 *
 * Runs LAST (see run-scenarios.ts) because it spends stock and cash. Every id is
 * prefixed `SCN-X-` so it can collide neither with the seed nor with the other
 * scenario files.
 */

const BRANCH = "BR-MAIN";
const WH = "WH-MAIN";
const WH2 = "WH-DEMO-2";
const CASH = "1300-1";
const BANK = "1310";
const AR = "1105";
const AP = "2100";
const INVENTORY = "1200";
const OUTPUT_TAX = "2200";
const INPUT_TAX = "1400";
const EQUITY = "3100";
const REVENUE = "4100";
const COGS = "5100";
const EXPENSE = "5900";
const UNDER_COLLECTION = "1320";
const BOUNCED = "1360";
const CASH_TREASURY = "TR-DEMO-CASH";
const BANK_TREASURY = "TR-DEMO-BANK";
const CUSTOMER = "CUST-DEMO-1";
const SUPPLIER = "SUPP-DEMO-1";
const TODAY = "2026-08-24";
const VAT = 14;

export async function run(ctx: Ctx): Promise<void> {
  const { req, n, check, checkEq, scenario } = ctx;

  /** The live balance of a GL account — the same number every treasury screen renders. */
  async function gl(code: string): Promise<number> {
    return n((await req("GET", `/gl/accounts/${code}/ledger`)).body?.balance?.balance);
  }

  /**
   * The magnitude of a CREDIT-natural account (equity, revenue, VAT payable, AP).
   * `/gl/accounts/:id/ledger` reports debit − credit, so these read negative;
   * flipping the sign here keeps every assertion below phrased the way a
   * finance user would say it out loud ("AP rose by 2,280").
   */
  async function creditBalance(code: string): Promise<number> {
    return -(await gl(code));
  }

  async function stock(itemId: string, warehouseId = WH) {
    const b = (await req("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${warehouseId}`)).body;
    return { onHand: n(b?.onHand), averageCost: n(b?.averageCost), totalValue: n(b?.totalValue) };
  }

  async function makeItem(id: string, code: string, nameAr: string) {
    return req("POST", "/items", {
      id, code, nameAr,
      type: "stock",
      baseUnitCode: "PCS",
      trackInventory: true,
      revenueAccountId: REVENUE,
      cogsAccountId: COGS,
      inventoryAccountId: INVENTORY,
    });
  }

  async function openStock(itemId: string, qty: string, unitCost: string, adjustmentId: string, warehouseId = WH) {
    await req("POST", "/inventory/stock-adjustments/draft", {
      id: adjustmentId,
      date: TODAY,
      lines: [{ itemId, warehouseId, reason: "INITIAL_STOCK", direction: "IN", qty, unitCost }],
    });
    return req("POST", `/inventory/stock-adjustments/${adjustmentId}/confirm`, {});
  }

  async function sellFor(id: string, itemId: string, nameAr: string, qty: string, unitPrice: string, customerId = CUSTOMER) {
    const customer = (await req("GET", `/customers/${customerId}`)).body;
    const created = await req("POST", "/sales-invoices", {
      id,
      date: TODAY,
      dueDate: "2026-09-23",
      customerId,
      customerNameAr: customer?.nameAr ?? "عميل",
      warehouseId: WH,
      branchId: BRANCH,
      arAccountId: AR,
      taxAccountId: OUTPUT_TAX,
      lines: [{
        lineId: `${id}-L1`,
        itemId,
        itemNameAr: nameAr,
        isStock: true,
        qty,
        unitPrice,
        taxRatePercent: VAT,
        revenueAccountId: REVENUE,
        cogsAccountId: COGS,
        inventoryAccountId: INVENTORY,
      }],
    });
    const confirmed = await req("POST", `/sales-invoices/${id}/confirm`, {});
    return { created, confirmed, grandTotal: n(confirmed.body?.totals?.grandTotal ?? created.body?.totals?.grandTotal) };
  }

  async function voucher(id: string, body: Record<string, unknown>) {
    const created = await req("POST", "/vouchers", { id, date: TODAY, branchId: BRANCH, ...body });
    const confirmed = await req("POST", `/vouchers/${id}/confirm`, {});
    return { created, confirmed };
  }

  async function journalBalances(journalEntryId: string): Promise<{ debit: number; credit: number; lines: any[] }> {
    const je = (await req("GET", `/gl/journal-entries/${journalEntryId}`)).body;
    const lines = (je?.lines ?? []) as any[];
    return {
      debit: lines.reduce((s, l) => s + n(l.debit), 0),
      credit: lines.reduce((s, l) => s + n(l.credit), 0),
      lines,
    };
  }

  /**
   * Earlier suites leave approval gates configured — platform.ts on
   * SALES_RETURN_CONFIRM, accounting.ts on TREASURY_VOUCHER_CONFIRM — and a
   * gated document is held "pending" mid-trail with no route that ever posts it
   * (see platform.ts's own findings). This file runs last and traces money end
   * to end, so it clears those two gates first rather than measuring a trail
   * that was suspended halfway.
   */
  const gatedActions = new Set(["SALES_RETURN_CONFIRM", "TREASURY_VOUCHER_CONFIRM", "PURCHASE_RETURN_CONFIRM"]);
  for (const config of ctx.rows((await req("GET", "/workflow/configs")).body) as any[]) {
    if (!gatedActions.has(config.actionType)) continue;
    const removed = await req("DELETE", `/workflow/configs/${config.id}`, undefined);
    check(`setup · cleared the ${config.actionType} approval gate left by an earlier suite`, removed.status === 204, `status ${removed.status}`);
  }

  // Every treasury movement this file makes is recorded here, so the final
  // scenario can prove the company's total cash moved by exactly the net of them.
  const treasuryLedger: Array<{ label: string; delta: number }> = [];
  const cashAndBankAtStart = (await gl(CASH)) + (await gl(BANK));

  // ---------------------------------------------------------------------------
  // X0 — funding: capital injection into the خزنة
  // ---------------------------------------------------------------------------
  await scenario("x0 · capital injection — partner money lands in the خزنة and in equity, nowhere else", async () => {
    const cashBefore = await gl(CASH);
    const equityBefore = await creditBalance(EQUITY);
    const amount = 250000;

    const { created, confirmed } = await voucher("SCN-X-CAP-1", {
      memo: "ضخ رأس مال لتمويل سيناريوهات التقاطع",
      voucherType: "capital_injection",
      amount: amount.toFixed(2),
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: EQUITY,
    });
    check("the injection voucher drafts", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    check("the injection voucher confirms and posts", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 200));

    checkEq("the خزنة (GL 1300-1) rises by exactly the injected amount", (await gl(CASH)) - cashBefore, amount);
    checkEq("equity (3100) rises by exactly the same amount — money arrives from an owner, not from thin air", (await creditBalance(EQUITY)) - equityBefore, amount);
    treasuryLedger.push({ label: "capital injection (cash)", delta: amount });
  });

  // ---------------------------------------------------------------------------
  // X1 — SELL → money into the BANK
  // ---------------------------------------------------------------------------
  await scenario("x1 · sell something → the money lands in the bank, AR clears, stock falls — one trail across sales, inventory, GL and treasury", async () => {
    const itemId = "SCN-X-ITEM-1";
    await makeItem(itemId, "SCN-X-1", "صنف بيع اختباري");
    await openStock(itemId, "100", "60", "SCN-X-ADJ-1");

    const stockBefore = await stock(itemId);
    const arBefore = await gl(AR);
    const bankBefore = await gl(BANK);
    const cashBefore = await gl(CASH);
    const revenueBefore = await creditBalance(REVENUE);
    const cogsBefore = await gl(COGS);
    const taxBefore = await creditBalance(OUTPUT_TAX);

    const sale = await sellFor("SCN-X-INV-1", itemId, "صنف بيع اختباري", "10", "100");
    check("the sale confirms", sale.confirmed.status === 200 && sale.confirmed.body?.status === "confirmed", JSON.stringify(sale.confirmed.body).slice(0, 200));
    checkEq("the invoice's grand total is 10 × 100 + 14% VAT", sale.grandTotal, 1140);

    checkEq("stock falls by exactly the sold quantity", stockBefore.onHand - (await stock(itemId)).onHand, 10);
    checkEq("AR (1105) rises by exactly the grand total", (await gl(AR)) - arBefore, 1140);
    checkEq("revenue (4100) rises by the net, not the gross", (await creditBalance(REVENUE)) - revenueBefore, 1000);
    checkEq("output VAT (2200) rises by exactly the tax", (await creditBalance(OUTPUT_TAX)) - taxBefore, 140);
    checkEq("COGS (5100) rises by quantity × unit cost, not by the selling price", (await gl(COGS)) - cogsBefore, 600);
    checkEq("confirming a sale moves NO money — the bank is untouched until someone actually pays", (await gl(BANK)) - bankBefore, 0);
    checkEq("and the خزنة is untouched too", (await gl(CASH)) - cashBefore, 0);

    // Now the customer pays, into the BANK.
    const { created, confirmed } = await voucher("SCN-X-COL-1", {
      memo: "تحصيل من عميل — تحويل بنكي",
      voucherType: "customer_collection",
      amount: "1140.00",
      paymentMethod: "bank",
      treasuryAccountId: BANK_TREASURY,
      treasuryGlAccountId: BANK,
      counterpartyGlAccountId: AR,
      customerId: CUSTOMER,
    });
    check("the collection voucher drafts", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    check("the collection voucher confirms", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 200));

    const allocation = await req("POST", "/vouchers/SCN-X-COL-1/allocations", { invoiceId: "SCN-X-INV-1", amount: "1140.00" });
    check("the collection allocates onto the invoice it pays", allocation.status === 201, JSON.stringify(allocation.body).slice(0, 200));

    checkEq("the BANK (GL 1310) rises by exactly what the customer paid", (await gl(BANK)) - bankBefore, 1140);
    checkEq("AR nets back to where it started — invoice raised it, collection cleared it", (await gl(AR)) - arBefore, 0);
    checkEq("the خزنة never moved: a bank collection must not touch the cash box", (await gl(CASH)) - cashBefore, 0);
    treasuryLedger.push({ label: "customer collection (bank)", delta: 1140 });

    const invoiceAfter = (await req("GET", "/sales-invoices/SCN-X-INV-1")).body;
    check(
      "D1 — the invoice's own amountPaid stays 0 even though the allocated collection cleared its AR in the GL " +
        "(docs/defects.md D1); the sub-ledger and the ledger disagree about the same payment",
      n(invoiceAfter?.amountPaid) === 0,
      `amountPaid=${invoiceAfter?.amountPaid} status=${invoiceAfter?.status}`,
    );
  });

  // ---------------------------------------------------------------------------
  // X2 — BUY → money out of the خزنة
  // ---------------------------------------------------------------------------
  await scenario("x2 · buy something → the money leaves the خزنة, AP clears, stock and its value rise", async () => {
    const itemId = "SCN-X-ITEM-2";
    await makeItem(itemId, "SCN-X-2", "صنف شراء اختباري");

    const cashBefore = await gl(CASH);
    const apBefore = await creditBalance(AP);
    const invBefore = await gl(INVENTORY);
    const inputTaxBefore = await gl(INPUT_TAX);
    const apReconBefore = (await ctx.invariants()).ap;

    const po = await req("POST", "/purchases/orders", {
      id: "SCN-X-PO-1",
      supplierId: SUPPLIER,
      date: TODAY,
      branchId: BRANCH,
      warehouseId: WH,
      lines: [{ itemId, qty: "40", unitPrice: "50" }],
    });
    check("the purchase order drafts", po.status === 201, JSON.stringify(po.body).slice(0, 200));
    const poConfirm = await req("POST", "/purchases/orders/SCN-X-PO-1/confirm", {});
    check("the purchase order confirms", poConfirm.status === 200, JSON.stringify(poConfirm.body).slice(0, 200));

    const grn = await req("POST", "/purchases/receipts", { id: "SCN-X-GRN-1", purchaseOrderId: "SCN-X-PO-1", date: TODAY });
    check("the goods receipt drafts off the order", grn.status === 201, JSON.stringify(grn.body).slice(0, 200));
    const grnConfirm = await req("POST", "/purchases/receipts/SCN-X-GRN-1/confirm", {});
    check("the goods receipt confirms", grnConfirm.status === 200, JSON.stringify(grnConfirm.body).slice(0, 200));

    checkEq("goods physically arrived: 40 on hand", (await stock(itemId)).onHand, 40);
    checkEq(
      "receiving goods moves NO money and posts NO GL — the خزنة is untouched by a receipt (documented behavior: the offset posts with the invoice)",
      (await gl(CASH)) - cashBefore,
      0,
    );

    const invoice = await req("POST", "/purchases/invoices", {
      id: "SCN-X-PI-1",
      supplierId: SUPPLIER,
      date: TODAY,
      dueDate: "2026-09-23",
      branchId: BRANCH,
      warehouseId: WH,
      receiptId: "SCN-X-GRN-1",
      lines: [{ itemId, kind: "inventory", qty: "40", unitCost: "50", taxRatePercent: VAT }],
    });
    check("the supplier invoice drafts", invoice.status === 201, JSON.stringify(invoice.body).slice(0, 200));
    const piConfirm = await req("POST", "/purchases/invoices/SCN-X-PI-1/confirm", {});
    check("the supplier invoice confirms", piConfirm.status === 200 && piConfirm.body?.status === "confirmed", JSON.stringify(piConfirm.body).slice(0, 200));
    checkEq("the invoice total is 2,000 + 14% VAT", n(piConfirm.body?.total), 2280);

    checkEq("inventory (GL 1200) rises by the goods' net value, VAT excluded", (await gl(INVENTORY)) - invBefore, 2000);
    checkEq("input VAT (1400) takes the tax, not inventory", (await gl(INPUT_TAX)) - inputTaxBefore, 280);
    checkEq("AP (2100) rises by the gross the supplier is owed", (await creditBalance(AP)) - apBefore, 2280);
    checkEq("still no money has moved — owing a supplier is not paying one", (await gl(CASH)) - cashBefore, 0);

    // Now pay the supplier, out of the خزنة.
    const { created, confirmed } = await voucher("SCN-X-PAY-1", {
      memo: "دفع لمورد من الخزينة",
      voucherType: "supplier_payment",
      amount: "2280.00",
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: AP,
      supplierId: SUPPLIER,
    });
    check("the payment voucher drafts", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    check("the payment voucher confirms", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 200));

    const allocation = await req("POST", "/vouchers/SCN-X-PAY-1/allocations", { invoiceId: "SCN-X-PI-1", amount: "2280.00" });
    check("the payment allocates onto the supplier invoice it settles", allocation.status === 201, JSON.stringify(allocation.body).slice(0, 200));

    checkEq("the خزنة (GL 1300-1) falls by exactly what was paid", cashBefore - (await gl(CASH)), 2280);
    checkEq("AP nets back to where it started — invoice raised it, payment cleared it", (await creditBalance(AP)) - apBefore, 0);
    treasuryLedger.push({ label: "supplier payment (cash)", delta: -2280 });

    const recon = ctx.rows((await req("GET", "/reconciliation")).body).find((r: any) => r.key === "ap");
    checkEq(
      "NEW DEFECT — paying a supplier de-reconciles AP: the GL control account 2100 falls by the payment while the AP sub-ledger does not move at all. " +
        "Root cause: packages/backend/src/create-backend.ts's resolveReconciliationControls() builds the AP sub-ledger figure from confirmed purchase-invoice totals " +
        "(minus returns, plus landed costs) and never subtracts allocations or treasury payments — the AP twin of D1, invisible until a scenario actually paid a supplier",
      n(recon?.subLedgerBalance) - n(recon?.glBalance),
      apReconBefore,
    );
  });

  // ---------------------------------------------------------------------------
  // X3 — cash sale: the same trail, settled the same day
  // ---------------------------------------------------------------------------
  await scenario("x3 · a cash sale nets AR to zero across the pair and puts the money in the خزنة, not the bank", async () => {
    const itemId = "SCN-X-ITEM-1";
    const arBefore = await gl(AR);
    const cashBefore = await gl(CASH);
    const bankBefore = await gl(BANK);

    const sale = await sellFor("SCN-X-INV-2", itemId, "صنف بيع اختباري", "5", "120");
    check("the cash sale's invoice confirms", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 200));
    const grand = 5 * 120 * 1.14;

    const { confirmed } = await voucher("SCN-X-COL-2", {
      memo: "تحصيل نقدي فوري",
      voucherType: "customer_collection",
      amount: grand.toFixed(2),
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: AR,
      customerId: CUSTOMER,
    });
    check("the cash collection confirms", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 200));
    await req("POST", "/vouchers/SCN-X-COL-2/allocations", { invoiceId: "SCN-X-INV-2", amount: grand.toFixed(2) });

    checkEq("the خزنة rises by exactly the grand total collected", (await gl(CASH)) - cashBefore, grand);
    checkEq("the bank stays out of it — a cash collection must not credit the bank", (await gl(BANK)) - bankBefore, 0);
    checkEq("AR nets to zero over the invoice-and-collection pair", (await gl(AR)) - arBefore, 0);
    treasuryLedger.push({ label: "cash sale collection", delta: grand });
  });

  // ---------------------------------------------------------------------------
  // X4 — moving money between treasuries
  // ---------------------------------------------------------------------------
  await scenario("x4 · a خزنة → bank transfer moves money without creating or destroying any", async () => {
    const cashBefore = await gl(CASH);
    const bankBefore = await gl(BANK);
    const amount = 5000;

    const { created, confirmed } = await voucher("SCN-X-TRF-1", {
      memo: "توريد نقدية من الخزينة إلى البنك",
      voucherType: "inter_treasury_transfer",
      amount: amount.toFixed(2),
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterTreasuryAccountId: BANK_TREASURY,
      counterTreasuryGlAccountId: BANK,
    });
    check("the transfer voucher drafts", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    check("the transfer voucher confirms", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 200));

    checkEq("the source خزنة falls by the transferred amount", cashBefore - (await gl(CASH)), amount);
    checkEq("the destination bank rises by exactly the same amount", (await gl(BANK)) - bankBefore, amount);
    checkEq("total company money is unchanged — a transfer is a move, not income", (await gl(CASH)) + (await gl(BANK)), cashBefore + bankBefore);
  });

  // ---------------------------------------------------------------------------
  // X5 — the خزنة cannot go negative; the bank can. Driven by a LIVE setting.
  // ---------------------------------------------------------------------------
  await scenario("x5 · the خزنة cannot be overdrawn — but the tenant setting that is supposed to govern that is not wired to the guard", async () => {
    const settings = (await req("GET", "/settings")).body;
    check("the tenant setting that is meant to drive the guard reads true by default", settings?.preventNegativeCashBalance === true, JSON.stringify(settings?.preventNegativeCashBalance));

    const cashNow = await gl(CASH);
    const overdraft = (cashNow + 10000).toFixed(2);
    await voucher("SCN-X-NEG-1", {
      memo: "صرف يتجاوز رصيد الخزينة",
      voucherType: "other_expense",
      amount: overdraft,
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: EXPENSE,
    });
    const blocked = (await req("GET", "/vouchers/SCN-X-NEG-1")).body;
    check("paying out more cash than the خزنة holds is refused and the voucher stays unposted", blocked?.status === "draft", `status=${blocked?.status}`);
    checkEq("and the خزنة balance is genuinely untouched by the refused attempt", await gl(CASH), cashNow);

    const off = await req("PUT", "/settings", { ...settings, preventNegativeCashBalance: false });
    check("the setting turns off and the API says so", off.status === 200 && off.body?.preventNegativeCashBalance === false, `status ${off.status} ${JSON.stringify(off.body?.preventNegativeCashBalance)}`);
    const reread = await req("GET", "/settings");
    check("and it really persisted — a re-read still says false", reread.body?.preventNegativeCashBalance === false, JSON.stringify(reread.body?.preventNegativeCashBalance));

    const retry = await req("POST", "/vouchers/SCN-X-NEG-1/confirm", {});
    check(
      "NEW DEFECT — the negative-cash guard ignores the tenant setting entirely: with منع الرصيد السالب للحسابات النقدية switched OFF the same voucher is still refused CASH_BALANCE_NEGATIVE. " +
        "Root cause: packages/backend/src/create-backend.ts's `vouchers:` options object (feeding createVouchersRoutes) never passes `settings`, and VoucherService.cashPolicy() " +
        "returns a hardcoded `true` whenever `deps.settings` is absent — so both preventNegativeCashBalance and allowNegativeTreasury are dead switches on the settings screen.",
      retry.status === 200 && retry.body?.status === "confirmed",
      `status ${retry.status} body ${JSON.stringify(retry.body).slice(0, 200)}`,
    );

    const back = await req("PUT", "/settings", { ...settings, preventNegativeCashBalance: true });
    check("the setting restores", back.status === 200, `status ${back.status}`);

    // Leave the tenant clean whichever way the assertion above went: cancel it if it
    // is still a draft, reverse it if the guard did let it post.
    const after = (await req("GET", "/vouchers/SCN-X-NEG-1")).body;
    if (after?.status === "draft") {
      const cancelled = await req("POST", "/vouchers/SCN-X-NEG-1/cancel", {});
      check("the refused draft is cancelled so it cannot post later by accident", cancelled.status === 200, `status ${cancelled.status}`);
    } else {
      await req("POST", "/vouchers/SCN-X-NEG-1/reverse", {});
    }
    check("either way the خزنة is left exactly as this scenario found it", Math.abs((await gl(CASH)) - cashNow) < 0.005, `cash=${await gl(CASH)} started=${cashNow}`);
  });

  // ---------------------------------------------------------------------------
  // X6 — sale return → refund out of the خزنة
  // ---------------------------------------------------------------------------
  await scenario("x6 · a sales return restocks and drops AR; refunding it is a SEPARATE cash movement that must be made by hand", async () => {
    const invoice = (await req("GET", "/sales-invoices/SCN-X-INV-1")).body;
    const line = invoice?.lines?.[0];
    check("the invoice from x1 is readable for the return", Boolean(line), JSON.stringify(invoice).slice(0, 200));
    if (!line) return;

    const returnQty = 2;
    const taxAmount = (returnQty * n(line.unitPrice) * 0.14).toFixed(2);
    const returnGrand = returnQty * n(line.unitPrice) + Number(taxAmount);

    const stockBefore = await stock(line.itemId);
    const arBefore = await gl(AR);
    const cashBefore = await gl(CASH);

    const created = await req("POST", "/sales-returns", {
      id: "SCN-X-RET-1",
      date: TODAY,
      memo: "مرتجع مبيعات — سيناريو تقاطع",
      lines: [{
        itemId: line.itemId,
        warehouseId: WH,
        customerId: invoice.customerId,
        sourceInvoiceId: invoice.id,
        sourceInvoiceNumber: invoice.docNo,
        reason: "DEFECTIVE",
        availableQty: line.qty,
        qty: String(returnQty),
        unitPrice: line.unitPrice,
        unitCost: line.unitCost,
        taxAmount,
      }],
    });
    check("the return drafts", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    const confirmed = await req("POST", "/sales-returns/SCN-X-RET-1/confirm", {});
    check("the return confirms", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 200));

    checkEq("the goods come back into stock", (await stock(line.itemId)).onHand - stockBefore.onHand, returnQty);
    checkEq("AR falls by the return's grand total", arBefore - (await gl(AR)), returnGrand);
    checkEq("confirming a return refunds NOTHING — the خزنة does not move on its own", (await gl(CASH)) - cashBefore, 0);
    check("and the return says so explicitly: it sits awaiting a refund", confirmed.body?.document?.awaitingRefund === true, JSON.stringify(confirmed.body?.document?.awaitingRefund));

    const { confirmed: refund } = await voucher("SCN-X-REF-1", {
      memo: "رد مبلغ لعميل بعد مرتجع",
      voucherType: "customer_refund",
      amount: returnGrand.toFixed(2),
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: AR,
      customerId: invoice.customerId,
    });
    check("the refund voucher confirms", refund.status === 200 && refund.body?.status === "confirmed", JSON.stringify(refund.body).slice(0, 200));
    checkEq("only NOW does the خزنة fall, by exactly the refunded amount", cashBefore - (await gl(CASH)), returnGrand);
    treasuryLedger.push({ label: "customer refund (cash)", delta: -returnGrand });
  });

  // ---------------------------------------------------------------------------
  // X7 — purchase return → refund from the supplier into the خزنة
  // ---------------------------------------------------------------------------
  await scenario("x7 · a purchase return drops stock and AP; the supplier's refund is a separate receipt into the خزنة", async () => {
    const itemId = "SCN-X-ITEM-2";
    const stockBefore = await stock(itemId);
    const apBefore = await creditBalance(AP);
    const cashBefore = await gl(CASH);
    const qty = 10;
    const grand = qty * 50 * 1.14;

    const created = await req("POST", "/purchase-returns", {
      id: "SCN-X-PRET-1",
      date: TODAY,
      memo: "مرتجع مشتريات — سيناريو تقاطع",
      lines: [{
        itemId,
        warehouseId: WH,
        supplierId: SUPPLIER,
        sourceInvoiceId: "SCN-X-PI-1",
        sourceInvoiceNumber: null,
        reason: "DEFECTIVE",
        availableQty: "40",
        qty: String(qty),
        unitCost: "50",
        taxAmount: (qty * 50 * 0.14).toFixed(2),
      }],
    });
    check("the purchase return drafts", created.status === 201, `status ${created.status} ${JSON.stringify(created.body).slice(0, 250)}`);
    const confirmed = await req("POST", "/purchase-returns/SCN-X-PRET-1/confirm", {});
    check("the purchase return confirms", confirmed.status === 200, `status ${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 250)}`);

    checkEq("the returned goods leave stock", stockBefore.onHand - (await stock(itemId)).onHand, qty);
    checkEq("AP falls by the return's grand total", apBefore - (await creditBalance(AP)), grand);
    checkEq("no money moved on the return itself", (await gl(CASH)) - cashBefore, 0);

    const { confirmed: refund } = await voucher("SCN-X-SREF-1", {
      memo: "استرداد نقدي من مورد",
      voucherType: "supplier_refund",
      amount: grand.toFixed(2),
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: AP,
      supplierId: SUPPLIER,
    });
    check("the supplier refund confirms", refund.status === 200 && refund.body?.status === "confirmed", JSON.stringify(refund.body).slice(0, 200));
    checkEq("the خزنة rises by exactly the refunded amount", (await gl(CASH)) - cashBefore, grand);
    treasuryLedger.push({ label: "supplier refund (cash)", delta: grand });
  });

  // ---------------------------------------------------------------------------
  // X8 — paid by cheque: the money is not in the bank until it clears
  // ---------------------------------------------------------------------------
  await scenario("x8 · a customer cheque against a real sale reaches the bank only on collection, never on receipt", async () => {
    const itemId = "SCN-X-ITEM-1";
    const sale = await sellFor("SCN-X-INV-3", itemId, "صنف بيع اختباري", "4", "150");
    check("the cheque-paid sale confirms", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 200));
    const grand = 4 * 150 * 1.14;

    const bankBefore = await gl(BANK);
    const underCollectionBefore = await gl(UNDER_COLLECTION);
    const arBefore = await gl(AR);

    const cheque = await req("POST", "/cheques", {
      id: "SCN-X-CHQ-1",
      direction: "incoming",
      chequeNumber: "SCN-X-7700001",
      bankName: "بنك الاختبار",
      issueDate: TODAY,
      dueDate: TODAY,
      branchId: BRANCH,
      partyId: CUSTOMER,
      counterpartyGlAccountId: AR,
      controlAccounts: { underCollectionAccountId: UNDER_COLLECTION, bouncedAccountId: BOUNCED },
      amount: grand.toFixed(2),
    });
    check("the cheque records against the customer", cheque.status === 201, JSON.stringify(cheque.body).slice(0, 200));
    checkEq("receiving a cheque already clears the customer's AR", arBefore - (await gl(AR)), grand);
    checkEq("but the money is NOT in the bank yet — it sits in شيكات تحت التحصيل", (await gl(BANK)) - bankBefore, 0);
    checkEq("شيكات تحت التحصيل (1320) holds exactly the cheque's face value", (await gl(UNDER_COLLECTION)) - underCollectionBefore, grand);

    const deposit = await req("POST", "/cheques/SCN-X-CHQ-1/deposit", { bankTreasuryAccountId: BANK_TREASURY });
    check("the cheque is handed to the bank", deposit.status === 200 && deposit.body?.status === "deposited", JSON.stringify(deposit.body).slice(0, 200));
    checkEq("depositing still does not credit the bank — the cheque has not cleared", (await gl(BANK)) - bankBefore, 0);

    const collect = await req("POST", "/cheques/SCN-X-CHQ-1/collect", { bankGlAccountId: BANK, date: TODAY });
    check("the cheque collects", collect.status === 200 && collect.body?.status === "collected", `status ${collect.status} ${JSON.stringify(collect.body).slice(0, 200)}`);
    checkEq("only on collection does the bank rise, by exactly the face value", (await gl(BANK)) - bankBefore, grand);
    checkEq("and شيكات تحت التحصيل empties back to where it was", (await gl(UNDER_COLLECTION)) - underCollectionBefore, 0);
    treasuryLedger.push({ label: "cheque collected (bank)", delta: grand });
  });

  // ---------------------------------------------------------------------------
  // X9 — landed cost changes what the NEXT sale costs
  // ---------------------------------------------------------------------------
  await scenario("x9 · a landed cost raises the item's unit cost, and the next sale's COGS charges the raised cost, not the invoice price", async () => {
    const itemId = "SCN-X-ITEM-3";
    await makeItem(itemId, "SCN-X-3", "صنف تكلفة إضافية");

    await req("POST", "/purchases/orders", {
      id: "SCN-X-PO-2", supplierId: SUPPLIER, date: TODAY, branchId: BRANCH, warehouseId: WH,
      lines: [{ itemId, qty: "100", unitPrice: "10" }],
    });
    await req("POST", "/purchases/orders/SCN-X-PO-2/confirm", {});
    await req("POST", "/purchases/receipts", { id: "SCN-X-GRN-2", purchaseOrderId: "SCN-X-PO-2", date: TODAY });
    const grnConfirm = await req("POST", "/purchases/receipts/SCN-X-GRN-2/confirm", {});
    check("the receipt for the landed-cost item confirms", grnConfirm.status === 200, JSON.stringify(grnConfirm.body).slice(0, 200));
    await req("POST", "/purchases/invoices", {
      id: "SCN-X-PI-2", supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WH,
      receiptId: "SCN-X-GRN-2",
      lines: [{ itemId, kind: "inventory", qty: "100", unitCost: "10", taxRatePercent: VAT }],
    });
    await req("POST", "/purchases/invoices/SCN-X-PI-2/confirm", {});

    const costBefore = (await stock(itemId)).averageCost;
    checkEq("the item lands at its purchase price before any freight is added", costBefore, 10);

    const invValueBefore = await gl(INVENTORY);
    const landed = await req("POST", "/landed-costs", {
      id: "SCN-X-LC-1",
      date: TODAY,
      memo: "شحن على فاتورة الشراء",
      distributionMethod: "BY_VALUE",
      costItems: [{ costType: "SHIPPING", description: "شحن", amount: "500" }],
      targets: [{
        itemId,
        warehouseId: WH,
        sourceInvoiceId: "SCN-X-PI-2",
        sourceInvoiceNumber: null,
        qty: "100",
        unitCost: "10",
      }],
    });
    check("the landed cost drafts against the receipt", landed.status === 201, `status ${landed.status} ${JSON.stringify(landed.body).slice(0, 250)}`);
    const lcConfirm = await req("POST", "/landed-costs/SCN-X-LC-1/confirm", {});
    check("the landed cost confirms", lcConfirm.status === 200, `status ${lcConfirm.status} ${JSON.stringify(lcConfirm.body).slice(0, 250)}`);

    const costAfter = (await stock(itemId)).averageCost;
    checkEq("the whole 500 of freight lands on the 100 units — unit cost rises by exactly 5", costAfter - costBefore, 5);
    checkEq("inventory value (GL 1200) rises by exactly the freight, no rounding leak", (await gl(INVENTORY)) - invValueBefore, 500);

    const cogsBefore = await gl(COGS);
    const sale = await sellFor("SCN-X-INV-4", itemId, "صنف تكلفة إضافية", "20", "40");
    check("the sale of the landed-cost item confirms", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 200));
    checkEq("COGS charges 20 × 15 — the landed cost, not the 10 on the supplier invoice", (await gl(COGS)) - cogsBefore, 300);
  });

  // ---------------------------------------------------------------------------
  // X10 — VAT: both sides of the tax, then paying it
  // ---------------------------------------------------------------------------
  await scenario("x10 · both halves of VAT — a sale raises output tax, a purchase raises input tax, the return reports exactly what the ledger holds, and paying it clears both", async () => {
    async function vatSides(): Promise<{ output: number; input: number }> {
      const res = await req("GET", `/financial-reports/vat-return?periodFrom=2026-01-01&periodTo=${TODAY}`);
      const rows = (res.body?.rows ?? []) as any[];
      return {
        output: rows.filter((r) => r.side === "output").reduce((sum, r) => sum + n(r.tax), 0),
        input: rows.filter((r) => r.side === "input").reduce((sum, r) => sum + n(r.tax), 0),
      };
    }

    const reportBefore = await vatSides();
    const outputGlBefore = await creditBalance(OUTPUT_TAX);
    const inputGlBefore = await gl(INPUT_TAX);

    const itemId = "SCN-X-ITEM-1";
    const sale = await sellFor("SCN-X-INV-VAT", itemId, "صنف بيع اختباري", "10", "200");
    check("the VAT-side sale confirms", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 200));

    const purchase = await req("POST", "/purchases/invoices", {
      id: "SCN-X-PI-VAT", supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WH,
      lines: [{ itemId: "SCN-X-ITEM-2", kind: "inventory", qty: "10", unitCost: "100", taxRatePercent: VAT }],
    });
    check("the VAT-side purchase drafts", purchase.status === 201, JSON.stringify(purchase.body).slice(0, 200));
    const purchaseConfirm = await req("POST", "/purchases/invoices/SCN-X-PI-VAT/confirm", {});
    check("the VAT-side purchase confirms", purchaseConfirm.status === 200, JSON.stringify(purchaseConfirm.body).slice(0, 200));

    checkEq("the sale put 14% of 2,000 into output VAT (2200)", (await creditBalance(OUTPUT_TAX)) - outputGlBefore, 280);
    checkEq("the purchase put 14% of 1,000 into input VAT (1400)", (await gl(INPUT_TAX)) - inputGlBefore, 140);

    const reportAfter = await vatSides();
    checkEq("the VAT return's output side moved by exactly what the sale posted to the ledger", reportAfter.output - reportBefore.output, 280);
    checkEq("the VAT return's input side moved by exactly what the purchase posted to the ledger", reportAfter.input - reportBefore.input, 140);
    checkEq("net VAT owed on this pair is output minus input", (reportAfter.output - reportBefore.output) - (reportAfter.input - reportBefore.input), 140);

    const bankBefore = await gl(BANK);
    const outputBeforePayment = await creditBalance(OUTPUT_TAX);
    const { confirmed } = await voucher("SCN-X-TAX-1", {
      memo: "سداد ضريبة القيمة المضافة",
      voucherType: "tax_payment",
      amount: "140.00",
      paymentMethod: "bank",
      treasuryAccountId: BANK_TREASURY,
      treasuryGlAccountId: BANK,
      counterpartyGlAccountId: OUTPUT_TAX,
    });
    check("the tax payment confirms", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 200));
    checkEq("the bank falls by exactly the VAT paid", bankBefore - (await gl(BANK)), 140);
    checkEq("and the VAT payable falls by the same — paying tax is not an expense, it settles a liability", outputBeforePayment - (await creditBalance(OUTPUT_TAX)), 140);
    if (confirmed.status === 200) treasuryLedger.push({ label: "VAT payment (bank)", delta: -140 });
  });

  // ---------------------------------------------------------------------------
  // X11 — HR spends from the SAME خزنة every other module uses
  // ---------------------------------------------------------------------------
  await scenario("x11 · an employee advance leaves the same خزنة a supplier payment leaves — one treasury, not one per module", async () => {
    const employees = ctx.rows((await req("GET", "/hr/employees")).body);
    const employee = employees.find((e: any) => e.status === "active") ?? employees[0];
    check("there is an employee to advance money to", Boolean(employee?.id), `employees=${employees.length}`);
    if (!employee?.id) return;

    const cashBefore = await gl(CASH);
    const amount = 3000;

    const created = await req("POST", "/hr/advances", {
      id: "SCN-X-ADV-1",
      employeeId: employee.id,
      amount: amount.toFixed(2),
      currency: "EGP",
      installmentCount: 3,
      firstDeductionDate: "2026-09-01",
      reason: "سلفة اختبار تقاطع",
    });
    check("the advance is requested", created.status === 201, `status ${created.status} ${JSON.stringify(created.body).slice(0, 250)}`);
    const approved = await req("POST", "/hr/advances/SCN-X-ADV-1/approve", {});
    check("the advance is approved", approved.status === 200, `status ${approved.status} ${JSON.stringify(approved.body).slice(0, 200)}`);

    const disbursed = await req("POST", "/hr/advances/SCN-X-ADV-1/disburse", {
      treasuryAccountId: CASH_TREASURY,
      branchId: BRANCH,
      date: TODAY,
      paymentMethod: "cash",
    });
    check("the advance is disbursed", disbursed.status === 200, `status ${disbursed.status} ${JSON.stringify(disbursed.body).slice(0, 250)}`);
    checkEq("the خزنة falls by exactly the advance — HR spends the treasury the treasury screen shows", cashBefore - (await gl(CASH)), amount);
    check("the disbursement is a real treasury voucher, not a private HR ledger", typeof disbursed.body?.disbursementVoucherId === "string", JSON.stringify(disbursed.body?.disbursementVoucherId));

    const voucherDoc = await req("GET", `/vouchers/${disbursed.body?.disbursementVoucherId}`);
    check("and that voucher is visible in the treasury module like any other", voucherDoc.status === 200, `status ${voucherDoc.status}`);
    treasuryLedger.push({ label: "employee advance (cash)", delta: -amount });
  });

  // ---------------------------------------------------------------------------
  // X12 — buying a fixed asset, then depreciating it
  // ---------------------------------------------------------------------------
  await scenario("x12 · a fixed asset bought with company money depreciates into the P&L without ever touching stock", async () => {
    const categories = ctx.rows((await req("GET", "/assets/categories")).body);
    const category = categories[0];
    check("there is an asset category to register against", Boolean(category?.id), `categories=${categories.length}`);
    if (!category?.id) return;

    const cashBefore = await gl(CASH);
    const inventoryBefore = await gl(INVENTORY);
    const cost = 60000;

    const { confirmed: paid } = await voucher("SCN-X-ASSET-PAY", {
      memo: "شراء أصل ثابت نقداً",
      voucherType: "other_expense",
      amount: cost.toFixed(2),
      paymentMethod: "bank",
      treasuryAccountId: BANK_TREASURY,
      treasuryGlAccountId: BANK,
      counterpartyGlAccountId: "1510",
    });
    check("paying for the asset out of the bank posts", paid.status === 200 && paid.body?.status === "confirmed", `status ${paid.status} ${JSON.stringify(paid.body).slice(0, 250)}`);

    const asset = await req("POST", "/assets", {
      id: "SCN-X-ASSET-1",
      code: "SCN-X-FA-1",
      nameAr: "معدة اختبار تقاطع",
      categoryId: category.id,
      acquisitionDate: TODAY,
      acquisitionCost: cost.toFixed(2),
      branchId: BRANCH,
      scope: "branch",
    });
    check("the asset registers", asset.status === 201, `status ${asset.status} ${JSON.stringify(asset.body).slice(0, 250)}`);
    checkEq("registering an asset never touches inventory — an asset is not stock", (await gl(INVENTORY)) - inventoryBefore, 0);
    checkEq("and registering it moves no money either; the payment above already did", (await gl(CASH)) - cashBefore, 0);

    const run = await req("POST", "/assets/depreciation/runs", { period: "2026-08", branchId: BRANCH });
    check("a depreciation run computes for the period", run.status === 201, `status ${run.status} ${JSON.stringify(run.body).slice(0, 250)}`);
    const runId = run.body?.id;
    const runLines = (run.body?.lines ?? []) as any[];
    check("the run includes the newly-registered asset", runLines.some((l) => l.assetId === "SCN-X-ASSET-1"), JSON.stringify(runLines.map((l) => l.assetId)).slice(0, 200));

    const posted = await req("POST", `/assets/depreciation/runs/${runId}/post`, {});
    check("the run posts", posted.status === 200, `status ${posted.status} ${JSON.stringify(posted.body).slice(0, 250)}`);
    const je = posted.body?.journalEntryId;
    check("posting depreciation writes a journal entry", typeof je === "string", JSON.stringify(je));
    if (typeof je === "string") {
      const balanced = await journalBalances(je);
      checkEq("the depreciation entry balances", balanced.debit, balanced.credit);
      checkEq("and it moves exactly the run's own total", balanced.debit, n(posted.body?.totalAmount ?? run.body?.totalAmount));
    }
    checkEq("depreciation costs the business value but not cash — the خزنة does not move", (await gl(CASH)) - cashBefore, 0);
    treasuryLedger.push({ label: "fixed asset purchase (bank)", delta: -cost });
  });

  // ---------------------------------------------------------------------------
  // X13 — manufacturing consumes stock and produces stock
  // ---------------------------------------------------------------------------
  await scenario("x13 · manufacturing turns raw material value into finished-goods value, and selling the output charges the produced cost", async () => {
    const rawId = "SCN-X-RAW-1";
    const finishedId = "SCN-X-FG-1";
    await makeItem(rawId, "SCN-X-RAW", "خامة اختبار");
    await makeItem(finishedId, "SCN-X-FG", "منتج تام اختبار");
    await openStock(rawId, "200", "25", "SCN-X-ADJ-RAW");

    const bom = await req("POST", "/manufacturing/boms", {
      id: "SCN-X-BOM-1",
      productItemId: finishedId,
      standardQty: "1",
      unit: "PCS",
      lines: [{ itemId: rawId, qty: "2" }],
    });
    check("a bill of materials is defined", bom.status === 201, `status ${bom.status} ${JSON.stringify(bom.body).slice(0, 250)}`);
    if (bom.status !== 201) return;

    const rawBefore = await stock(rawId);
    const wo = await req("POST", "/manufacturing/work-orders", {
      id: "SCN-X-WO-1",
      bomId: "SCN-X-BOM-1",
      plannedQty: "10",
      sourceWarehouseId: WH,
      destinationWarehouseId: WH,
      scheduledStartDate: TODAY,
    });
    check("the work order opens", wo.status === 201, `status ${wo.status} ${JSON.stringify(wo.body).slice(0, 250)}`);
    await req("POST", "/manufacturing/work-orders/SCN-X-WO-1/start", {});
    const issued = await req("POST", "/manufacturing/work-orders/SCN-X-WO-1/issue", { lines: [{ itemId: rawId, qty: "20" }] });
    check("raw material is issued to the floor", issued.status === 200, `status ${issued.status} ${JSON.stringify(issued.body).slice(0, 250)}`);
    checkEq("the raw material genuinely leaves the warehouse", rawBefore.onHand - (await stock(rawId)).onHand, 20);

    const received = await req("POST", "/manufacturing/work-orders/SCN-X-WO-1/receive", { producedQty: "10" });
    check("the finished goods are received", received.status === 200, `status ${received.status} ${JSON.stringify(received.body).slice(0, 250)}`);
    const completed = await req("POST", "/manufacturing/work-orders/SCN-X-WO-1/complete", {});
    check("the work order completes", completed.status === 200, `status ${completed.status} ${JSON.stringify(completed.body).slice(0, 250)}`);

    const fg = await stock(finishedId);
    checkEq("10 finished units exist", fg.onHand, 10);
    checkEq("each carries the 2 × 25 of material it consumed — value moved, it was not invented", fg.averageCost, 50);

    const cogsBefore = await gl(COGS);
    const sale = await sellFor("SCN-X-INV-5", finishedId, "منتج تام اختبار", "3", "200");
    check("the finished product sells", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 200));
    checkEq("COGS charges the manufactured cost of 3 × 50", (await gl(COGS)) - cogsBefore, 150);
  });

  // ---------------------------------------------------------------------------
  // X14 — writing stock down hits the P&L and the balance sheet by one figure
  // ---------------------------------------------------------------------------
  await scenario("x14 · an inventory write-down charges the P&L through a provision account, leaving the inventory control account and its reconciliation intact", async () => {
    const inventoryBefore = await gl(INVENTORY);
    const provisionBefore = await creditBalance("1190");
    const expenseBefore = await gl("5060");
    const reconBefore = (await ctx.invariants()).inventory;

    const run = await req("POST", "/inventory/writedown-runs", { period: "2026-08", warehouseId: WH });
    check("a write-down run computes for the period", run.status === 201, `status ${run.status} ${JSON.stringify(run.body).slice(0, 250)}`);
    if (run.status !== 201) return;

    const total = n(run.body?.totalAmount);
    const runId = run.body?.id;
    check("the run found aged stock to write down", total > 0, `totalAmount=${total}`);
    if (total <= 0) return;

    const posted = await req("POST", `/inventory/writedown-runs/${runId}/post`, {});
    check("the write-down posts", posted.status === 200, `status ${posted.status} ${JSON.stringify(posted.body).slice(0, 250)}`);

    checkEq("the write-down expense (5060) takes the whole run total", (await gl("5060")) - expenseBefore, total);
    checkEq("the provision for slow-moving stock (1190) takes the same amount", (await creditBalance("1190")) - provisionBefore, total);
    checkEq(
      "the inventory control account (1200) is deliberately NOT touched — the loss is carried in a contra account, so the stock sub-ledger and GL 1200 stay reconciled",
      (await gl(INVENTORY)) - inventoryBefore,
      0,
    );
    checkEq("and the reconciliation figure confirms it: the inventory gap is exactly where it was", (await ctx.invariants()).inventory, reconBefore);

    const je = posted.body?.journalEntryId;
    check("the write-down posted a journal entry", typeof je === "string", JSON.stringify(je));
    if (typeof je === "string") {
      const balanced = await journalBalances(je);
      checkEq("the write-down entry balances", balanced.debit, balanced.credit);
    }
  });

  // ---------------------------------------------------------------------------
  // X15 — closing the period stops EVERY module, not just accounting
  // ---------------------------------------------------------------------------
  await scenario("x15 · closing a fiscal period blocks sales, purchases and treasury alike — one gate, every module", async () => {
    const periods = ctx.rows((await req("GET", "/fiscal-periods?year=2026")).body);
    const august = periods.find((p: any) => p.periodNumber === 8);
    check("August 2026 — the period every document in this file is dated into — exists", Boolean(august?.id), `periods=${periods.length}`);
    if (!august?.id) return;

    // Documents drafted BEFORE the close, so the only thing the close can stop is the posting.
    const itemId = "SCN-X-ITEM-1";
    const customer = (await req("GET", `/customers/${CUSTOMER}`)).body;
    await req("POST", "/sales-invoices", {
      id: "SCN-X-INV-BLOCKED", date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER,
      customerNameAr: customer?.nameAr ?? "عميل", warehouseId: WH, branchId: BRANCH,
      arAccountId: AR, taxAccountId: OUTPUT_TAX,
      lines: [{ lineId: "SCN-X-INV-BLOCKED-L1", itemId, itemNameAr: "صنف بيع اختباري", isStock: true, qty: "1", unitPrice: "100", taxRatePercent: VAT, revenueAccountId: REVENUE, cogsAccountId: COGS, inventoryAccountId: INVENTORY }],
    });
    await req("POST", "/purchases/invoices", {
      id: "SCN-X-PI-BLOCKED", supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: BRANCH, warehouseId: WH,
      lines: [{ itemId: "SCN-X-ITEM-2", kind: "inventory", qty: "1", unitCost: "50", taxRatePercent: VAT }],
    });
    await req("POST", "/vouchers", {
      id: "SCN-X-VCH-BLOCKED", date: TODAY, memo: "سند في فترة مقفلة", voucherType: "other_expense",
      amount: "100.00", branchId: BRANCH, paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY, treasuryGlAccountId: CASH, counterpartyGlAccountId: EXPENSE,
    });

    const closed = await req("POST", `/fiscal-periods/${august.id}/close`, {});
    check("August closes", closed.status === 200 && closed.body?.status === "closed", `status ${closed.status} ${JSON.stringify(closed.body).slice(0, 200)}`);

    const cashDuringClose = await gl(CASH);
    const inventoryReconBefore = (await ctx.invariants()).inventory;
    const attempts: Array<[string, Promise<any>]> = [
      ["a sales invoice", req("POST", "/sales-invoices/SCN-X-INV-BLOCKED/confirm", {})],
      ["a purchase invoice", req("POST", "/purchases/invoices/SCN-X-PI-BLOCKED/confirm", {})],
      ["a treasury voucher", req("POST", "/vouchers/SCN-X-VCH-BLOCKED/confirm", {})],
      ["a manual journal entry", req("POST", "/gl/journal-entries", {
        id: "SCN-X-JE-BLOCKED", date: TODAY, memo: "قيد في فترة مقفلة",
        lines: [{ accountId: CASH, debit: "10.00", credit: "0.00" }, { accountId: EXPENSE, debit: "0.00", credit: "10.00" }],
      })],
    ];
    for (const [label, pending] of attempts) {
      const res = await pending;
      check(
        `confirming ${label} into a closed period is refused with a period error, not a crash` +
          (label === "a purchase invoice"
            ? " — NEW DEFECT: this one answers 500 Internal Server Error. packages/api/src/purchases-routes.ts's confirm handler does not map PeriodNotOpenForPostingError (thrown by the GL port inside confirmPurchaseInvoice), unlike the sales, voucher and journal routes which all return 422"
            : ""),
        res.status === 422 || res.status === 409,
        `status ${res.status} body ${JSON.stringify(res.body).slice(0, 200)}`,
      );
    }
    checkEq(
      "NEW DEFECT — the crashed purchase-invoice confirm is not atomic: it moved stock IN before the GL refused the closed period, so the inventory sub-ledger is left running ahead of GL 1200 " +
        "by exactly the blocked line's value with no document to explain it",
      (await ctx.invariants()).inventory,
      inventoryReconBefore,
    );
    checkEq("and nothing slipped through: the خزنة is exactly where it was when the period closed", await gl(CASH), cashDuringClose);

    const reopened = await req("POST", `/fiscal-periods/${august.id}/reopen`, {});
    check("August reopens", reopened.status === 200 && reopened.body?.status === "open", `status ${reopened.status} ${JSON.stringify(reopened.body).slice(0, 200)}`);

    const retry = await req("POST", "/vouchers/SCN-X-VCH-BLOCKED/confirm", {});
    check("the very same voucher now posts — the gate was the period, nothing else", retry.status === 200 && retry.body?.status === "confirmed", `status ${retry.status} ${JSON.stringify(retry.body).slice(0, 200)}`);
    if (retry.status === 200) treasuryLedger.push({ label: "expense voucher after reopen (cash)", delta: -100 });
  });

  // ---------------------------------------------------------------------------
  // X16 — reversing a payment puts the money back everywhere
  // ---------------------------------------------------------------------------
  await scenario("x16 · reversing a confirmed payment returns the خزنة, the counter-account and the trial balance to their exact prior values", async () => {
    const cashBefore = await gl(CASH);
    const expenseBefore = await gl(EXPENSE);
    const tbBefore = (await ctx.invariants()).tb;

    const { confirmed } = await voucher("SCN-X-EXP-1", {
      memo: "مصروف يُعكس لاحقاً",
      voucherType: "other_expense",
      amount: "1750.00",
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: EXPENSE,
    });
    check("the expense posts", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 200));
    checkEq("the خزنة falls by the expense", cashBefore - (await gl(CASH)), 1750);
    checkEq("the expense account rises by the same", (await gl(EXPENSE)) - expenseBefore, 1750);

    const reversed = await req("POST", "/vouchers/SCN-X-EXP-1/reverse", {});
    check("the voucher reverses", reversed.status === 200 || reversed.status === 201, `status ${reversed.status} ${JSON.stringify(reversed.body).slice(0, 200)}`);
    checkEq("the خزنة returns to exactly its pre-payment balance", await gl(CASH), cashBefore);
    checkEq("and so does the expense account — a reversal undoes both legs, not one", await gl(EXPENSE), expenseBefore);
    checkEq("the trial balance is exactly as balanced as before", (await ctx.invariants()).tb, tbBefore);

    const original = await req("GET", "/vouchers/SCN-X-EXP-1");
    check("the reversed voucher is marked, never deleted — the audit trail survives", original.body?.status === "reversed", `status=${original.body?.status}`);
  });

  // ---------------------------------------------------------------------------
  // X17 — the dashboard reports the same money the ledger holds
  // ---------------------------------------------------------------------------
  await scenario("x17 · the dashboard's cash, receivables and payables agree with the ledger accounts they claim to summarise", async () => {
    const dash = await req("GET", `/dashboard/summary?toDate=${TODAY}`);
    check("the dashboard loads", dash.status === 200, `status ${dash.status} ${JSON.stringify(dash.body).slice(0, 200)}`);
    const glBlock = dash.body?.gl ?? dash.body;

    // Recomputed the way a reader of the balance sheet would: every POSTABLE account
    // of the right kind, on its natural side, as of the same date the tile claims.
    const accounts = ctx.rows((await req("GET", "/accounts")).body);
    let cashSum = 0;
    let receivableSum = 0;
    let payableSum = 0;
    for (const a of accounts as any[]) {
      if (a.isHeader) continue;
      const code = String(a.code ?? "");
      const raw = n((await req("GET", `/gl/accounts/${a.id}/ledger?asOf=${TODAY}`)).body?.balance?.balance);
      const natural = a.naturalBalance === "credit" ? -raw : raw;
      if (a.type === "asset" && code.startsWith("13")) cashSum += natural;
      if (a.type === "asset" && code.startsWith("11")) receivableSum += natural;
      if (a.type === "liability" && code !== OUTPUT_TAX) payableSum += natural;
    }

    checkEq("dashboard cash equals the sum of every 13xx cash/bank account, this file's movements included", n(glBlock?.cash), cashSum);
    checkEq("dashboard receivables equals the sum of every 11xx asset account", n(glBlock?.receivables), receivableSum);
    checkEq("dashboard payables equals the sum of every liability account except output VAT", n(glBlock?.payables), payableSum);
  });

  // ---------------------------------------------------------------------------
  // X19 — credit control: settings + customer master + sales confirm
  // ---------------------------------------------------------------------------
  await scenario("x19 · a customer's credit limit blocks the sale, and a voucher collection does NOT free the limit up again (the reach of D1)", async () => {
    const settings = (await req("GET", "/settings")).body;
    const customerId = "SCN-X-CUST-CREDIT";
    const created = await req("POST", "/customers", {
      id: customerId,
      code: "SCN-X-C1",
      nameAr: "عميل بحد ائتماني",
      creditLimit: "1000.00",
      currency: "EGP",
    });
    check("a customer with a 1,000 credit limit is created", created.status === 201, `status ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);

    const on = await req("PUT", "/settings", { ...settings, creditControlEnabled: true, creditControlMode: "BLOCK" });
    check("credit control is switched on in BLOCK mode", on.status === 200 && on.body?.creditControlEnabled === true, `status ${on.status}`);

    const itemId = "SCN-X-ITEM-1";
    const over = await sellFor("SCN-X-INV-CREDIT", itemId, "صنف بيع اختباري", "10", "150", customerId);
    check(
      "confirming an invoice that would take the customer past the limit is refused, with the Arabic credit message",
      over.confirmed.status === 422 && String(over.confirmed.body?.error).includes("CREDIT"),
      `status ${over.confirmed.status} body ${JSON.stringify(over.confirmed.body).slice(0, 200)}`,
    );

    const within = await sellFor("SCN-X-INV-CREDIT-OK", itemId, "صنف بيع اختباري", "5", "150", customerId);
    check("an invoice inside the limit (855 < 1,000) confirms normally", within.confirmed.status === 200, `status ${within.confirmed.status} ${JSON.stringify(within.confirmed.body).slice(0, 200)}`);

    // The customer pays in full through the treasury, exactly as they would in real life.
    const cashBefore = await gl(CASH);
    const { confirmed } = await voucher("SCN-X-COL-CREDIT", {
      memo: "تحصيل كامل من عميل بحد ائتماني",
      voucherType: "customer_collection",
      amount: "855.00",
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: AR,
      customerId,
    });
    check("the collection confirms and reaches the خزنة", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 200));
    checkEq("the money is genuinely in the خزنة", (await gl(CASH)) - cashBefore, 855);
    await req("POST", "/vouchers/SCN-X-COL-CREDIT/allocations", { invoiceId: "SCN-X-INV-CREDIT-OK", amount: "855.00" });
    if (confirmed.status === 200) treasuryLedger.push({ label: "credit-customer collection (cash)", delta: 855 });

    const retry = await sellFor("SCN-X-INV-CREDIT-2", itemId, "صنف بيع اختباري", "1", "100", customerId);
    check(
      "NEW FINDING (a consequence of D1, not a separate bug) — the customer has paid every piastre through the treasury, yet their credit exposure still counts the paid invoice: " +
        "credit control reads the invoice's own amountPaid, which a confirmed and allocated collection voucher never updates. A customer who always pays by voucher silently freezes at their limit.",
      retry.confirmed.status === 200,
      `status ${retry.confirmed.status} body ${JSON.stringify(retry.confirmed.body).slice(0, 220)}`,
    );

    const off = await req("PUT", "/settings", { ...settings, creditControlEnabled: settings?.creditControlEnabled, creditControlMode: settings?.creditControlMode });
    check("credit control is restored to the tenant's own setting", off.status === 200, `status ${off.status}`);
  });

  // ---------------------------------------------------------------------------
  // X20 — a credit sale becomes an instalment plan
  // ---------------------------------------------------------------------------
  await scenario("x20 · an instalment plan on a real invoice schedules exactly what is owed, and the down payment is a treasury movement of its own", async () => {
    const itemId = "SCN-X-ITEM-1";
    const sale = await sellFor("SCN-X-INV-INST", itemId, "صنف بيع اختباري", "10", "300", CUSTOMER);
    check("the credit sale confirms", sale.confirmed.status === 200, JSON.stringify(sale.confirmed.body).slice(0, 200));
    const invoice = (await req("GET", "/sales-invoices/SCN-X-INV-INST")).body;
    const total = n(invoice?.totals?.grandTotal);
    const downPayment = 420;

    const plan = await req("POST", "/installments/plans", {
      id: "SCN-X-PLAN-1",
      date: TODAY,
      memo: "تقسيط فاتورة اختبار",
      customerId: CUSTOMER,
      sourceInvoiceId: "SCN-X-INV-INST",
      sourceInvoiceNumber: invoice?.docNo ?? null,
      invoiceTotal: total.toFixed(2),
      downPayment: downPayment.toFixed(2),
      installmentCount: 6,
      frequency: "MONTHLY",
      startDate: "2026-09-01",
    });
    check("the plan drafts against the invoice", plan.status === 201, `status ${plan.status} ${JSON.stringify(plan.body).slice(0, 250)}`);
    if (plan.status !== 201) return;

    const lines = (plan.body?.lines ?? []) as any[];
    check("the plan has one line per instalment", lines.length === 6, `lines=${lines.length}`);
    checkEq("the instalments sum to exactly the invoice total minus the down payment — no rounding leak", lines.reduce((sum, l) => sum + n(l.amount), 0), total - downPayment);

    const cashBefore = await gl(CASH);
    const arBefore = await gl(AR);
    const { confirmed } = await voucher("SCN-X-COL-DOWN", {
      memo: "دفعة مقدمة على خطة تقسيط",
      voucherType: "customer_collection",
      amount: downPayment.toFixed(2),
      paymentMethod: "cash",
      treasuryAccountId: CASH_TREASURY,
      treasuryGlAccountId: CASH,
      counterpartyGlAccountId: AR,
      customerId: CUSTOMER,
    });
    check("the down payment is collected as a normal treasury voucher", confirmed.status === 200, JSON.stringify(confirmed.body).slice(0, 200));
    checkEq("the خزنة rises by the down payment", (await gl(CASH)) - cashBefore, downPayment);
    checkEq("AR falls by the down payment", arBefore - (await gl(AR)), downPayment);
    if (confirmed.status === 200) treasuryLedger.push({ label: "instalment down payment (cash)", delta: downPayment });

    await req("POST", "/vouchers/SCN-X-COL-DOWN/allocations", { invoiceId: "SCN-X-INV-INST", amount: downPayment.toFixed(2) });
    const planAfter = (await req("GET", "/installments/plans/SCN-X-PLAN-1")).body;
    const paidLines = ((planAfter?.lines ?? []) as any[]).filter((l) => n(l.paidAmount) > 0);
    check(
      "documented behavior, not a new defect — collecting money against the invoice leaves every instalment line untouched: no route anywhere marks a line paid (docs/scenarios/06 INST-08)",
      paidLines.length === 0,
      `lines with a payment recorded: ${paidLines.length}`,
    );
  });

  // ---------------------------------------------------------------------------
  // X21 — a van trip carries stock AND cash out of the branch
  // ---------------------------------------------------------------------------
  await scenario("x21 · opening a van trip is a stock and cash custody transfer; settling it prices the shortfall", async () => {
    const employees = ctx.rows((await req("GET", "/hr/employees")).body) as any[];
    const driver = employees.find((e) => e.status === "active") ?? employees[0];
    check("there is an employee to crew the van", Boolean(driver?.id), `employees=${employees.length}`);
    if (!driver?.id) return;

    const itemId = "SCN-X-ITEM-1";
    const mainBefore = await stock(itemId, WH);
    const vanBefore = await stock(itemId, "WH-DEMO-VAN");
    const branchCashBefore = await gl(CASH);
    const vanCashBefore = await gl("1300-2");

    const opened = await req("POST", "/field/van-trips", {
      id: "SCN-X-TRIP-1",
      date: TODAY,
      branchId: BRANCH,
      vanWarehouseId: "WH-DEMO-VAN",
      vanTreasuryAccountId: "TR-DEMO-VAN",
      sourceWarehouseId: WH,
      sourceTreasuryAccountId: CASH_TREASURY,
      openingCashFloat: "500.00",
      crew: [{ employeeId: driver.id, role: "driver" }],
      loadedStock: [{ itemId, qty: "10" }],
    });
    check("the trip opens", opened.status === 201, `status ${opened.status} ${JSON.stringify(opened.body).slice(0, 250)}`);
    if (opened.status !== 201) return;
    const tripId = opened.body?.id ?? "SCN-X-TRIP-1";

    check(
      "FLD-11 (docs/scenarios/06) — the route discards the caller's id, so the trip must be found by listing, not by the id that was sent",
      tripId !== "SCN-X-TRIP-1",
      `returned id=${tripId}`,
    );

    checkEq("loading the van moves the stock out of the branch warehouse for real", mainBefore.onHand - (await stock(itemId, WH)).onHand, 10);
    checkEq("and the same 10 units arrive in the van's own warehouse", (await stock(itemId, "WH-DEMO-VAN")).onHand - vanBefore.onHand, 10);
    checkEq("the cash float genuinely leaves the branch خزنة", branchCashBefore - (await gl(CASH)), 500);
    checkEq("and lands in the van's treasury account (GL 1300-2) — custody moved, company money did not change", (await gl("1300-2")) - vanCashBefore, 500);

    const roadsideSale = 700;
    const movement = await req("POST", `/field/van-trips/${tripId}/cash-movements`, {
      id: "SCN-X-TRIP-1-M1",
      kind: "sale",
      amount: roadsideSale.toFixed(2),
      occurredAt: `${TODAY}T10:00:00.000Z`,
    });
    check("a roadside sale is recorded on the trip", movement.status === 200 || movement.status === 201, `status ${movement.status} ${JSON.stringify(movement.body).slice(0, 250)}`);

    // The settlement transfers the counted cash out of the van's treasury, so it
    // can only be counted up to what that account actually holds — see the defect
    // named below for why those two figures are not the same thing.
    const vanHoldsNow = await gl("1300-2");
    const countedCash = Math.min(500 + roadsideSale - 50, vanHoldsNow);
    const expectedCash = 500 + roadsideSale;

    const settled = await req("POST", `/field/van-trips/${tripId}/settle`, {
      countedCash: countedCash.toFixed(2),
      stockCounts: [{ itemId, countedQty: "3" }],
    });
    check("the trip settles", settled.status === 200, `status ${settled.status} ${JSON.stringify(settled.body).slice(0, 250)}`);
    const settlement = settled.body?.settlement;
    checkEq(`expected cash = float 500 + roadside sales ${roadsideSale}; the count is measured against that`, n(settlement?.expectedCash), expectedCash);
    checkEq("the cash variance is counted minus expected, to the piastre", n(settlement?.cashVariance), countedCash - expectedCash);
    const countLine = (settlement?.stockCounts ?? []).find((l: any) => l.itemId === itemId);
    checkEq("the van was expected to still hold the 10 it loaded — no roadside sale ever moved its stock", n(countLine?.expectedQty), 10);
    checkEq("3 were counted, so the settlement prices a 7-unit shortfall", n(countLine?.varianceQty), -7);

    const branchCashAfter = await gl(CASH);
    const vanCashAfter = await gl("1300-2");
    checkEq("settling hands the counted cash back to the branch خزنة, net of the float it lent out", branchCashAfter - branchCashBefore, countedCash - 500);
    checkEq(
      "NEW DEFECT — the van's treasury account is left short by the roadside takings: POST /field/van-trips/:id/cash-movements only mutates the trip document " +
        "(packages/api/src/field-sales-routes.ts) and posts nothing to the van treasury, yet settling transfers the FULL counted cash — float plus those unposted sales — out of it. " +
        "Every completed trip drives the van's cash account down by exactly the cash its sales brought in.",
      vanCashAfter,
      vanCashBefore,
    );
    treasuryLedger.push({ label: "van trip float out and settlement in (cash)", delta: branchCashAfter - branchCashBefore });
  });

  // ---------------------------------------------------------------------------
  // X22 — the bank statement must agree with the vouchers
  // ---------------------------------------------------------------------------
  await scenario("x22 · a bank statement reconciles against the vouchers that produced it, and reconciling posts nothing to the ledger", async () => {
    const bankBefore = await gl(BANK);
    const tbBefore = (await ctx.invariants()).tb;

    const rawCsv = [
      "date,description,amount,reference",
      `${TODAY},تحصيل من عميل,1140.00,SCN-X-COL-1`,
      `${TODAY},سداد ضريبة القيمة المضافة,-140.00,SCN-X-TAX-1`,
      `${TODAY},رسوم بنكية غير مسجلة,-35.00,BANKFEE-1`,
    ].join("\n");

    const imported = await req("POST", "/bank-statements/import", {
      id: "SCN-X-STMT-1",
      treasuryAccountId: BANK_TREASURY,
      rawCsv,
      mapping: { dateColumn: "date", descriptionColumn: "description", amountColumn: "amount", referenceColumn: "reference", dateFormat: "YYYY-MM-DD" },
      periodStart: "2026-08-01",
      periodEnd: TODAY,
      openingBalance: "0.00",
      closingBalance: "965.00",
    });
    check("the statement imports and parses its three lines", imported.status === 201 && (imported.body?.lines ?? []).length === 3, `status ${imported.status} ${JSON.stringify(imported.body).slice(0, 250)}`);
    if (imported.status !== 201) return;
    const statementId = imported.body?.id;

    const matched = await req("POST", `/bank-statements/${statementId}/auto-match`, {});
    check("auto-match runs", matched.status === 200, `status ${matched.status} ${JSON.stringify(matched.body).slice(0, 250)}`);

    const after = (await req("GET", `/bank-statements/${statementId}`)).body;
    const lines = (after?.lines ?? []) as any[];
    const unmatched = lines.filter((l) => l.status !== "matched");
    check(
      "the bank fee that no voucher explains stays unmatched — that is the whole point of the screen",
      unmatched.some((l) => String(l.reference ?? "").includes("BANKFEE")),
      JSON.stringify(lines.map((l) => ({ ref: l.reference, status: l.status }))),
    );

    checkEq("importing and matching a statement moves no money — the bank balance is untouched", await gl(BANK), bankBefore);
    checkEq("and posts nothing: the trial balance is exactly as it was", (await ctx.invariants()).tb, tbBefore);
  });

  // ---------------------------------------------------------------------------
  // X18 — nothing appeared from nowhere
  // ---------------------------------------------------------------------------
  await scenario("x18 · company-wide money conservation: cash + bank moved by exactly the net of the vouchers this file posted", async () => {
    const expected = treasuryLedger.reduce((s, m) => s + m.delta, 0);
    const actual = (await gl(CASH)) + (await gl(BANK)) - cashAndBankAtStart;
    checkEq(
      `total treasury movement equals the net of every recorded receipt and payment (${treasuryLedger.map((m) => `${m.label} ${m.delta.toFixed(2)}`).join(" · ")})`,
      actual,
      expected,
    );

    const tb = await req("GET", `/financial-reports/trial-balance?asOfDate=${TODAY}`);
    checkEq("and after every trail in this file, the trial balance still balances exactly", n(tb.body?.grandTotals?.debit), n(tb.body?.grandTotals?.credit));

    const bs = await req("GET", `/financial-reports/balance-sheet?asOfDate=${TODAY}`);
    const rows = (bs.body?.rows ?? []) as any[];
    const assets = rows.filter((r) => r.side === "asset").reduce((s, r) => s + n(r.amount), 0);
    const liabilitiesEquity = rows.filter((r) => r.side === "liability-equity").reduce((s, r) => s + n(r.amount), 0);
    checkEq("and the balance sheet still balances", assets, liabilitiesEquity);
  });
}
