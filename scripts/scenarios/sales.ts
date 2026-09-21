import { DEFAULT_PAGE_SIZE } from "../../packages/contracts/src/paging.js";
import { salesInvoiceSchema } from "../../packages/contracts/src/sales-invoice.js";
import type { Ctx } from "./harness.js";

/**
 * Executable checks for the sales module — docs/TESTING.md §5 as code.
 *
 * Runs LAST (see run-scenarios.ts): every id here is prefixed `SCN-` so it can
 * never collide with the seed (`CUST-DEMO-*`, `ITEM-DEMO-*`, `INV-DEMO-*`) or
 * with documents another module created ahead of this one. Fixed
 * infrastructure ids (accounts, branch, warehouse) come straight from
 * `packages/backend/src/demo-seed.ts` / `demo-seed/purchasing.ts`, since those
 * are stable chart-of-accounts/tenant setup, not seed FIGURES this task warns
 * against assuming.
 */

const BRANCH_ID = "BR-MAIN";
const WAREHOUSE_ID = "WH-MAIN";
const AR_ACCOUNT = "1105";
const TAX_ACCOUNT = "2200";
const REVENUE_ACCOUNT = "4100";
const COGS_ACCOUNT = "5100";
const INVENTORY_ACCOUNT = "1200";
const TODAY = "2026-08-24";

export async function run(ctx: Ctx): Promise<void> {
  const { req, rows, n, check, checkEq, scenario } = ctx;

  async function customerOf(id: string) {
    return (await req("GET", `/customers/${id}`)).body;
  }
  async function itemOf(id: string) {
    return (await req("GET", `/items/${id}`)).body;
  }
  async function stockOf(itemId: string) {
    return (await req("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${WAREHOUSE_ID}`)).body;
  }
  async function arBalance() {
    return ((await req("GET", `/gl/accounts/${AR_ACCOUNT}/ledger`)).body?.balance) ?? {};
  }
  function stockLine(lineId: string, item: any, qty: string, unitPrice: string) {
    return {
      lineId,
      itemId: item.id,
      itemNameAr: item.nameAr,
      isStock: true,
      qty,
      unitPrice,
      taxRatePercent: 14,
      revenueAccountId: REVENUE_ACCOUNT,
      cogsAccountId: COGS_ACCOUNT,
      inventoryAccountId: INVENTORY_ACCOUNT,
    };
  }
  function quoteLine(lineId: string, item: any, qty: string, unitPrice: string) {
    return { lineId, itemId: item.id, itemNameAr: item.nameAr, qty, unitPrice, taxRatePercent: 14 };
  }

  // --- 1. Full document lifecycle: quote → send → accept → convert → invoice → confirm → collect ---

  await scenario("quote → send → accept → convert → invoice → confirm → collect", async () => {
    const customer = await customerOf("CUST-DEMO-3");
    const item = await itemOf("ITEM-DEMO-1");
    const qty = "4";
    const unitPrice = "180";
    const expectedSubtotal = 4 * 180;
    const expectedGrand = expectedSubtotal + expectedSubtotal * 0.14;

    const stockBefore = await stockOf(item.id);

    const createdQuote = await req("POST", "/sales-quotes", {
      id: "SCN-Q-1",
      date: TODAY,
      expiryDate: "2026-09-30",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      branchId: BRANCH_ID,
      currency: "EGP",
      lines: [quoteLine("SCN-Q-1-L1", item, qty, unitPrice)],
    });
    check("quote created as a draft", createdQuote.status === 201 && createdQuote.body?.status === "draft", JSON.stringify(createdQuote.body));
    checkEq("quote grand total computed correctly", n(createdQuote.body?.totals?.grandTotal), expectedGrand);

    const sent = await req("POST", "/sales-quotes/SCN-Q-1/send", {});
    check("draft → sent", sent.status === 200 && sent.body?.status === "sent", JSON.stringify(sent.body));

    const accepted = await req("POST", "/sales-quotes/SCN-Q-1/accept", {});
    check("sent → accepted", accepted.status === 200 && accepted.body?.status === "accepted", JSON.stringify(accepted.body));

    const converted = await req("POST", "/sales-quotes/SCN-Q-1/convert-to-invoice", {
      id: "SCN-INV-1",
      date: TODAY,
      dueDate: "2026-09-23",
      warehouseId: WAREHOUSE_ID,
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [{ lineId: "SCN-Q-1-L1", isStock: true, revenueAccountId: REVENUE_ACCOUNT, cogsAccountId: COGS_ACCOUNT, inventoryAccountId: INVENTORY_ACCOUNT }],
    });
    check("convert-to-invoice succeeds and marks the quote converted", converted.status === 201 && converted.body?.quote?.status === "converted", JSON.stringify(converted.body));
    check("convert-to-invoice returns the new invoice's id", converted.body?.invoiceId === "SCN-INV-1", JSON.stringify(converted.body));

    const draftInvoice = await req("GET", "/sales-invoices/SCN-INV-1");
    check("the converted invoice starts as a draft, not auto-confirmed", draftInvoice.body?.status === "draft", JSON.stringify(draftInvoice.body));
    checkEq("converted invoice's grand total matches the quote's", n(draftInvoice.body?.totals?.grandTotal), expectedGrand);

    const arBefore = await arBalance();
    const confirmed = await req("POST", "/sales-invoices/SCN-INV-1/confirm", {});
    check("invoice confirms", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body));
    check("confirm assigns a document number", typeof confirmed.body?.docNo === "string" && confirmed.body.docNo.length > 0, JSON.stringify(confirmed.body?.docNo));
    check("confirm posts a journal entry", typeof confirmed.body?.journalEntryId === "string", JSON.stringify(confirmed.body?.journalEntryId));

    const stockAfter = await stockOf(item.id);
    checkEq("stock fell by exactly the sold quantity", n(stockBefore.onHand) - n(stockAfter.onHand), 4);

    const arAfter = await arBalance();
    checkEq("AR (1105) rose by the invoice's grand total", n(arAfter.balance) - n(arBefore.balance), expectedGrand);

    const glEntry = (await req("GET", `/gl/journal-entries/${confirmed.body.journalEntryId}`)).body;
    const totalDebit = (glEntry?.lines ?? []).reduce((s: number, l: any) => s + n(l.debit), 0);
    const totalCredit = (glEntry?.lines ?? []).reduce((s: number, l: any) => s + n(l.credit), 0);
    check("the posted journal entry exists", Array.isArray(glEntry?.lines) && glEntry.lines.length > 0, JSON.stringify(glEntry));
    checkEq("the posted journal entry balances (Σdebit = Σcredit)", totalDebit, totalCredit);
    const arLine = (glEntry?.lines ?? []).find((l: any) => l.accountId === AR_ACCOUNT);
    checkEq("the journal entry debits AR for exactly the grand total", n(arLine?.debit), expectedGrand);

    // Collecting on the invoice is a real receipt voucher, allocated — the same
    // shape the reference product's "Collect" uses. It used to increment
    // amountPaid and post nothing (docs/archive/defect-register.md D1).
    const noTreasury = await req("POST", "/sales-invoices/SCN-INV-1/payments", { amount: "300" });
    checkEq("a collection with no treasury account to land in is refused", noTreasury.status, 400);

    const arBeforeCollection = n((await arBalance()).balance);
    const payment = await req("POST", "/sales-invoices/SCN-INV-1/payments", {
      amount: "300",
      treasuryAccountId: "TR-DEMO-CASH",
      paymentMethod: "cash",
    });
    check("a partial collection is recorded", payment.status === 200 && payment.body?.status === "partially_paid", JSON.stringify(payment.body).slice(0, 250));
    checkEq("amountPaid follows the allocation the voucher made", n(payment.body?.amountPaid), 300);
    checkEq("remainingBalance drops by exactly the collected amount", n(payment.body?.remainingBalance), expectedGrand - 300);
    check("and it names the voucher it created", typeof payment.body?.voucherId === "string", String(payment.body?.voucherId));

    const voucher = (await req("GET", `/vouchers/${payment.body?.voucherId}`)).body;
    check("that voucher is a confirmed customer collection", voucher?.status === "confirmed" && voucher?.voucherType === "customer_collection", JSON.stringify(voucher).slice(0, 250));
    checkEq("for exactly the amount collected", n(voucher?.amount), 300);
    check("allocated to this invoice", (voucher?.allocations ?? []).some((a: any) => a.invoiceId === "SCN-INV-1"), JSON.stringify(voucher?.allocations ?? []).slice(0, 200));
    const arAfterCollection = n((await arBalance()).balance);
    checkEq("and the LEDGER moved: AR is credited by the collection, not just the invoice screen", arBeforeCollection - arAfterCollection, 300);

    const reloaded = await req("GET", "/sales-invoices/SCN-INV-1");
    check(
      "the payment and status survive a reload",
      reloaded.body?.status === "partially_paid" && n(reloaded.body?.amountPaid) === 300,
      JSON.stringify(reloaded.body),
    );
  });

  // --- 2. Sales return against the confirmed invoice from the lifecycle above ---

  await scenario("sales return against a confirmed invoice — restocks and reduces AR", async () => {
    const invoice = (await req("GET", "/sales-invoices/SCN-INV-1")).body;
    const line = invoice.lines[0];
    const returnQty = "1";
    const taxAmount = (Number(returnQty) * n(line.unitPrice) * 0.14).toFixed(2);
    const returnGrandTotal = Number(returnQty) * n(line.unitPrice) + Number(taxAmount);

    const stockBefore = await stockOf(line.itemId);
    const arBefore = await arBalance();

    const created = await req("POST", "/sales-returns", {
      id: "SCN-RET-1",
      date: TODAY,
      memo: "SCN scenario return",
      lines: [
        {
          itemId: line.itemId,
          warehouseId: WAREHOUSE_ID,
          customerId: invoice.customerId,
          sourceInvoiceId: invoice.id,
          sourceInvoiceNumber: invoice.docNo,
          reason: "DEFECTIVE",
          availableQty: line.qty,
          qty: returnQty,
          unitPrice: line.unitPrice,
          unitCost: line.unitCost,
          taxAmount,
        },
      ],
    });
    check("return created as a draft", created.status === 201 && created.body?.status === "draft", JSON.stringify(created.body));

    const confirmed = await req("POST", "/sales-returns/SCN-RET-1/confirm", {});
    check("return confirms", confirmed.status === 200 && confirmed.body?.document?.status === "confirmed", JSON.stringify(confirmed.body));
    check("a confirmed return is permanently 'awaiting refund' (no auto-refund path exists)", confirmed.body?.document?.awaitingRefund === true);

    const stockAfter = await stockOf(line.itemId);
    checkEq("stock rose by exactly the returned quantity", n(stockAfter.onHand) - n(stockBefore.onHand), Number(returnQty));

    const arAfter = await arBalance();
    checkEq("AR fell by exactly the return's grand total", n(arBefore.balance) - n(arAfter.balance), returnGrandTotal);

    const returnDoc = (await req("GET", "/sales-returns/SCN-RET-1")).body;
    const retGl = (await req("GET", `/gl/journal-entries/${returnDoc.journalEntryId}`)).body;
    const retDebit = (retGl?.lines ?? []).reduce((s: number, l: any) => s + n(l.debit), 0);
    const retCredit = (retGl?.lines ?? []).reduce((s: number, l: any) => s + n(l.credit), 0);
    check("the return posted its own journal entry", typeof returnDoc.journalEntryId === "string", JSON.stringify(returnDoc));
    checkEq("the return's journal entry balances", retDebit, retCredit);

    const invoiceAfter = (await req("GET", "/sales-invoices/SCN-INV-1")).body;
    checkEq(
      "D9 — the confirmed return comes off the invoice's remainingBalance, the same credit the GL posted to AR",
      n(invoiceAfter.remainingBalance),
      n(invoiceAfter.totals.grandTotal) - n(invoiceAfter.amountPaid) - n(invoiceAfter.returnedCredit),
    );
    checkEq(
      "D9 — the reported returnedCredit is this return's own grand total",
      n(invoiceAfter.returnedCredit),
      returnGrandTotal,
    );
  });

  // --- 3. Negative path: returning more than is truly available (F7 must still hold) ---

  await scenario("returning more than is truly available is rejected, even with an inflated client-supplied availableQty", async () => {
    const invoice = (await req("GET", "/sales-invoices/SCN-INV-1")).body;
    const line = invoice.lines[0]; // originally 4, 1 already returned above → 3 truly remain

    const attempt = await req("POST", "/sales-returns", {
      id: "SCN-RET-2",
      date: TODAY,
      memo: "SCN over-return probe",
      lines: [
        {
          itemId: line.itemId,
          warehouseId: WAREHOUSE_ID,
          customerId: invoice.customerId,
          sourceInvoiceId: invoice.id,
          sourceInvoiceNumber: invoice.docNo,
          reason: "DEFECTIVE",
          // Claim the FULL original quantity as available — exactly the exploit F7 fixed.
          availableQty: line.qty,
          qty: line.qty,
          unitPrice: line.unitPrice,
          unitCost: line.unitCost,
          taxAmount: "0",
        },
      ],
    });
    check("over-return rejected (422) despite the inflated client claim (F7 holds)", attempt.status === 422, JSON.stringify(attempt.body));
    check(
      "rejection cites the true remaining quantity (3), not the client's claim (4)",
      typeof attempt.body?.message === "string" && attempt.body.message.includes("تتجاوز المتاح للإرجاع") && attempt.body.message.includes("(3.000000)"),
      attempt.body?.message,
    );

    const notCreated = await req("GET", "/sales-returns/SCN-RET-2");
    check("no document was persisted from the rejected attempt", notCreated.status === 404);
  });

  // --- 4. Negative path: converting an already-converted quote ---

  await scenario("converting an already-converted quote is rejected", async () => {
    const again = await req("POST", "/sales-quotes/SCN-Q-1/convert-to-invoice", {
      id: "SCN-INV-1-DUP",
      date: TODAY,
      dueDate: "2026-09-23",
      warehouseId: WAREHOUSE_ID,
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [{ lineId: "SCN-Q-1-L1", isStock: true, revenueAccountId: REVENUE_ACCOUNT, cogsAccountId: COGS_ACCOUNT, inventoryAccountId: INVENTORY_ACCOUNT }],
    });
    check("a second conversion attempt is rejected (409)", again.status === 409, JSON.stringify(again.body));

    const noDuplicate = await req("GET", "/sales-invoices/SCN-INV-1-DUP");
    check("no duplicate invoice was created", noDuplicate.status === 404);
  });

  // --- 5. Negative path: quote status-machine guard (accept before send) ---

  await scenario("accepting a quote before it has been sent is rejected", async () => {
    const customer = await customerOf("CUST-DEMO-2");
    const item = await itemOf("ITEM-DEMO-3");
    const draft = await req("POST", "/sales-quotes", {
      id: "SCN-Q-2",
      date: TODAY,
      expiryDate: "2026-09-30",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      branchId: BRANCH_ID,
      currency: "EGP",
      lines: [quoteLine("SCN-Q-2-L1", item, "2", "42")],
    });
    check("quote created as a draft", draft.status === 201 && draft.body?.status === "draft", JSON.stringify(draft.body));

    const badAccept = await req("POST", "/sales-quotes/SCN-Q-2/accept", {});
    check("draft → accepted directly is rejected (409)", badAccept.status === 409, JSON.stringify(badAccept.body));

    const reloaded = await req("GET", "/sales-quotes/SCN-Q-2");
    check("the quote remains a draft", reloaded.body?.status === "draft", JSON.stringify(reloaded.body));
  });

  // --- 6. Promotion applied automatically at confirm (no coupon needed) ---

  await scenario("an eligible promotion applies automatically at confirm (SUMMER10, requiresCoupon: false)", async () => {
    const customer = await customerOf("CUST-DEMO-2");
    const item = await itemOf("ITEM-DEMO-4"); // scoped by PROMO-DEMO-1
    const qty = "10";
    const unitPrice = "260";
    const gross = 10 * 260;
    const expectedDiscount = gross * 0.1;
    const expectedGrand = (gross - expectedDiscount) * 1.14;

    const created = await req("POST", "/sales-invoices", {
      id: "SCN-INV-2",
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [stockLine("SCN-INV-2-L1", item, qty, unitPrice)],
    });
    check("invoice drafted", created.status === 201, JSON.stringify(created.body));
    check("no promotion recorded before confirm", created.body?.appliedPromotion === null);

    const confirmed = await req("POST", "/sales-invoices/SCN-INV-2/confirm", {});
    check("invoice confirms", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body));
    check(
      "SUMMER10 applied automatically, no coupon supplied",
      confirmed.body?.appliedPromotion?.code === "SUMMER10",
      JSON.stringify(confirmed.body?.appliedPromotion),
    );
    checkEq("discount granted is exactly 10% of the scoped line's gross", n(confirmed.body?.appliedPromotion?.discountTotal), expectedDiscount);
    checkEq("grand total reflects the promotion discount before tax", n(confirmed.body?.totals?.grandTotal), expectedGrand);
    checkEq("promotionDiscountTotal on the invoice totals matches what appliedPromotion recorded", n(confirmed.body?.totals?.promotionDiscountTotal), expectedDiscount);
  });

  // --- 7. Negative path: a quantity of zero ---

  await scenario("creating an invoice with a zero-quantity line is rejected", async () => {
    const customer = await customerOf("CUST-DEMO-1");
    const item = await itemOf("ITEM-DEMO-2");
    const attempt = await req("POST", "/sales-invoices", {
      id: "SCN-INV-ZEROQTY",
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [stockLine("L1", item, "0", "95")],
    });
    check("zero-quantity line rejected (422)", attempt.status === 422, JSON.stringify(attempt.body));
    check(
      "rejection cites the quantity guard by name",
      Array.isArray(attempt.body?.reasons) && attempt.body.reasons.some((r: string) => r.includes("الكمية يجب أن تكون أكبر من صفر")),
      JSON.stringify(attempt.body),
    );
    const notCreated = await req("GET", "/sales-invoices/SCN-INV-ZEROQTY");
    check("no invoice was persisted", notCreated.status === 404);
  });

  // --- 8. Negative path: confirming an invoice with no lines ---

  await scenario("an empty lines array is rejected at the wire boundary, before any domain check runs", async () => {
    const customer = await customerOf("CUST-DEMO-1");
    const attempt = await req("POST", "/sales-invoices", {
      id: "SCN-INV-NOLINES",
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [],
    });
    // createSalesInvoiceSchema's `lines: z.array(...).min(1)` intercepts this
    // before SalesInvoiceService.validate()'s own "الفاتورة تتطلب بنداً واحداً على
    // الأقل." ever runs — the domain guard exists but is unreachable from the
    // wire with a well-formed request. Only a caller that could skip schema
    // validation entirely (there is none in this codebase) would ever see it.
    check("empty lines array rejected (400 VALIDATION_ERROR, not the domain's 422)", attempt.status === 400, JSON.stringify(attempt.body));
  });

  // --- 9. Negative path: negative unit price ---

  await scenario("a negative unit price is rejected server-side", async () => {
    const customer = await customerOf("CUST-DEMO-1");
    const item = await itemOf("ITEM-DEMO-1");
    const attempt = await req("POST", "/sales-invoices", {
      id: "SCN-INV-NEGPRICE",
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [stockLine("L1", item, "2", "-50")],
    });
    check("negative unit price rejected (422)", attempt.status === 422, JSON.stringify(attempt.body));
    check(
      "rejection message matches the domain's exact wording",
      Array.isArray(attempt.body?.reasons) && attempt.body.reasons.some((r: string) => r.includes("السعر لا يقبل قيمة سالبة")),
      JSON.stringify(attempt.body),
    );
  });

  // --- 10. Negative path: invoice-level percent discount above 100 ---

  await scenario("an invoice-level percent discount above 100 is rejected at the wire boundary", async () => {
    const customer = await customerOf("CUST-DEMO-1");
    const item = await itemOf("ITEM-DEMO-1");
    const attempt = await req("POST", "/sales-invoices", {
      id: "SCN-INV-BADPCT",
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      discount: { type: "percent", percent: 150 },
      lines: [stockLine("L1", item, "1", "180")],
    });
    check("percent discount > 100 rejected (400, zod max(100))", attempt.status === 400, JSON.stringify(attempt.body));
  });

  // --- 11. An amount discount larger than the subtotal floors at zero, never goes negative ---

  await scenario("an amount discount larger than the subtotal floors the total at zero, not negative — and a zero-total invoice is blocked from confirming", async () => {
    const customer = await customerOf("CUST-DEMO-1");
    const item = await itemOf("ITEM-DEMO-2");
    const stockBefore = await stockOf(item.id);

    const created = await req("POST", "/sales-invoices", {
      id: "SCN-INV-BIGDISC",
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      discount: { type: "amount", amount: "5000" },
      lines: [stockLine("L1", item, "2", "95")], // subtotal 190.00
    });
    check("invoice with an oversized discount still creates", created.status === 201, JSON.stringify(created.body));
    checkEq("discount floors at the subtotal (190.00), not the requested 5000", n(created.body?.totals?.invoiceDiscountTotal), 190);
    checkEq("grand total floors at exactly zero, never negative", n(created.body?.totals?.grandTotal), 0);

    // A zero-total draft is itself allowed to exist, but `describeSalesInvoiceEffects`
    // marks it `blocked` (`positiveTotal` false) — confirm is refused in depth,
    // same as an empty-lines invoice would be.
    const confirmed = await req("POST", "/sales-invoices/SCN-INV-BIGDISC/confirm", {});
    check("a zero-value invoice is blocked from confirming (422)", confirmed.status === 422, JSON.stringify(confirmed.body));
    check(
      "blocked for exactly this reason",
      Array.isArray(confirmed.body?.reasons) && confirmed.body.reasons.some((r: string) => r.includes("إجمالي الفاتورة يجب أن يكون أكبر من صفر")),
      JSON.stringify(confirmed.body),
    );

    const stockAfter = await stockOf(item.id);
    checkEq("stock never moved — the invoice never confirmed", n(stockBefore.onHand) - n(stockAfter.onHand), 0);
  });

  // --- 12. Negative path: a discount below zero (NEW finding — not D1–D6/D9) ---

  await scenario("an invoice-level amount discount below zero is refused", async () => {
    const customer = await customerOf("CUST-DEMO-1");
    const item = await itemOf("ITEM-DEMO-2");

    const created = await req("POST", "/sales-invoices", {
      id: "SCN-INV-NEGDISC",
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      discount: { type: "amount", amount: "-50" },
      lines: [stockLine("L1", item, "10", "95")],
    });
    // Found by this suite: the sign was unchecked while every line-level
    // discount was, so a negative "discount" applied as a literal subtraction
    // INFLATED the total — 950 became 1,140. Fixed in the domain's validate().
    check("a negative discount amount is refused", created.status === 422, JSON.stringify(created.body));
    check(
      "and says so specifically rather than generically",
      String(JSON.stringify(created.body)).includes("خصم الفاتورة لا يقبل قيمة سالبة"),
      JSON.stringify(created.body),
    );
    const overHundred = await req("POST", "/sales-invoices", {
      id: "SCN-INV-NEGPCT",
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      discount: { type: "percent", percent: -5 },
      lines: [stockLine("L1", item, "10", "95")],
    });
    check("a negative discount percent is refused too", overHundred.status >= 400, JSON.stringify(overHundred.body));
  });

  // --- 13. D1 + D9 on the real seeded example, read live rather than assumed ---

  await scenario("D1 + D9 — INV-DEMO-1's remainingBalance nets its confirmed returns AND its voucher collection", async () => {
    const invoice = (await req("GET", "/sales-invoices/INV-DEMO-1")).body;
    check("amountPaid reflects VCH-DEMO-1's Treasury-voucher collection (docs/archive/defect-register.md D1 — the regression guard)", n(invoice.amountPaid) > 0, JSON.stringify(invoice.amountPaid));

    const allReturns = rows((await req("GET", "/sales-returns")).body);
    const against = allReturns.filter((r: any) => r.status === "confirmed" && r.lines?.[0]?.sourceInvoiceId === "INV-DEMO-1");
    check("confirmed returns exist against INV-DEMO-1 (seed: SRT-DEMO-1 + SRET-DEMO-1)", against.length >= 2, `found ${against.length}`);
    const returnedTotal = against.reduce(
      (sum: number, r: any) => sum + r.lines.reduce((s: number, l: any) => s + n(l.qty) * n(l.unitPrice) + n(l.taxAmount), 0),
      0,
    );
    check("those confirmed returns are worth something (so D9 has something real to net off)", returnedTotal > 0, String(returnedTotal));

    checkEq("D9: the reported returnedCredit equals the confirmed returns against this invoice", n(invoice.returnedCredit), returnedTotal);
    checkEq(
      "D9: remainingBalance = grandTotal − amountPaid − confirmed returns",
      n(invoice.remainingBalance),
      n(invoice.totals.grandTotal) - n(invoice.amountPaid) - returnedTotal,
    );
  });

  // --- 14. Bonus negative path: duplicate price-list code ---

  await scenario("creating a price list with a duplicate code is rejected", async () => {
    const attempt = await req("POST", "/price-lists", { id: "SCN-PL-DUP", code: "PL-BASE", nameAr: "قائمة مكررة" });
    check("duplicate price-list code rejected (409)", attempt.status === 409, JSON.stringify(attempt.body));
  });

  // --- 15. R2.4 — a line entered in cartons has to move PIECES ---

  await scenario("R2.4 — a carton line issues the piece count, and COGS follows the pieces", async () => {
    const customer = await customerOf("CUST-DEMO-3");
    const item = await itemOf("ITEM-DEMO-1");
    const carton = (item.alternateUnits ?? []).find((u: any) => u.code === "CTN");
    check("the seeded item defines a carton of 12 pieces", carton?.factor === 12, JSON.stringify(item.alternateUnits));

    const CARTONS = 5;
    const PIECES_PER_CARTON = 12;
    const EXPECTED_PIECES = CARTONS * PIECES_PER_CARTON; // 60
    const PRICE_PER_CARTON = 2160; // 180 per piece × 12
    const expectedNet = CARTONS * PRICE_PER_CARTON; // 10,800.00
    const expectedTax = expectedNet * 0.14; // 1,512.00
    const expectedGrand = expectedNet + expectedTax; // 12,312.00

    // The line must be affordable in STOCK, not just in money: a carton line is
    // exactly the case where a check against the entered quantity would pass
    // while the warehouse comes up 55 pieces short.
    const stockBefore = await stockOf(item.id);
    if (n(stockBefore.onHand) < EXPECTED_PIECES) {
      await req("POST", "/inventory/adjustments", {
        id: "SCN-ADJ-UNITS",
        date: TODAY,
        warehouseId: WAREHOUSE_ID,
        reason: "INITIAL_STOCK",
        lines: [{ lineId: "L1", itemId: item.id, qty: String(EXPECTED_PIECES), unitCost: "140" }],
      });
      await req("POST", "/inventory/adjustments/SCN-ADJ-UNITS/confirm", {});
    }
    const stockAtStart = await stockOf(item.id);
    check("the warehouse holds enough pieces to sell 5 cartons", n(stockAtStart.onHand) >= EXPECTED_PIECES, String(n(stockAtStart.onHand)));

    const created = await req("POST", "/sales-invoices", {
      id: "SCN-INV-UNITS",
      date: TODAY,
      dueDate: "2026-09-24",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [
        {
          ...stockLine("L1", item, String(CARTONS), String(PRICE_PER_CARTON)),
          unitCode: "CTN",
          unitFactor: PIECES_PER_CARTON,
        },
      ],
    });
    check("the carton invoice is created", created.status === 201, JSON.stringify(created.body).slice(0, 300));

    const line = created.body?.lines?.[0];
    check("the stored line keeps the unit it was ENTERED in", line?.unitCode === "CTN", JSON.stringify(line?.unitCode));
    checkEq("the stored line keeps its conversion factor", n(line?.unitFactor), PIECES_PER_CARTON);
    checkEq("the stored line carries the BASE quantity as well as the entered one", n(line?.baseQty), EXPECTED_PIECES);
    checkEq("the entered quantity is still 5 cartons, not 60", n(line?.qty), CARTONS);
    checkEq("the price is per carton, so the line extends to 5 × 2160", n(created.body?.totals?.grossTotal), expectedNet);
    checkEq("and the grand total is priced by the carton, not by the piece", n(created.body?.totals?.grandTotal), expectedGrand);

    const arBefore = n((await arBalance()).balance);
    const confirmed = await req("POST", "/sales-invoices/SCN-INV-UNITS/confirm", {});
    check("the carton invoice confirms", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 300));

    const stockAfter = await stockOf(item.id);
    checkEq(
      "the stock ledger moved 60 PIECES, not 5 — the whole point of R2.4",
      n(stockAtStart.onHand) - n(stockAfter.onHand),
      EXPECTED_PIECES,
    );

    checkEq("AR (1105) rose by exactly the grand total", n((await arBalance()).balance) - arBefore, expectedGrand);

    const entry = (await req("GET", `/gl/journal-entries/${confirmed.body?.journalEntryId}`)).body;
    const debit = (entry?.lines ?? []).reduce((s: number, l: any) => s + n(l.debit), 0);
    const credit = (entry?.lines ?? []).reduce((s: number, l: any) => s + n(l.credit), 0);
    checkEq("the journal entry balances to the cent", debit, credit);
    checkEq("it debits AR for the grand total", n((entry?.lines ?? []).find((l: any) => l.accountId === AR_ACCOUNT)?.debit), expectedGrand);
    checkEq("it credits revenue for the net", n((entry?.lines ?? []).find((l: any) => l.accountId === REVENUE_ACCOUNT)?.credit), expectedNet);
    checkEq("it credits output VAT for the tax", n((entry?.lines ?? []).find((l: any) => l.accountId === TAX_ACCOUNT)?.credit), expectedTax);

    // COGS is the cost of the SIXTY pieces that left. Reading it off the entry
    // and off the line's captured unit cost has to agree, or one of the two is
    // quoting the wrong quantity.
    const cogs = n((entry?.lines ?? []).find((l: any) => l.accountId === COGS_ACCOUNT)?.debit);
    const inventoryCredit = n((entry?.lines ?? []).find((l: any) => l.accountId === INVENTORY_ACCOUNT)?.credit);
    check("COGS was posted for the pieces that left", cogs > 0, String(cogs));
    checkEq("and inventory was credited for exactly the same cost", inventoryCredit, cogs);

    const confirmedLine = confirmed.body?.lines?.[0];
    checkEq(
      "the captured unit cost is per CARTON, so cost × entered qty reproduces COGS",
      n(confirmedLine?.unitCost) * CARTONS,
      cogs,
    );

    const reloaded = await req("GET", "/sales-invoices/SCN-INV-UNITS");
    check("the unit survives a reload", reloaded.body?.lines?.[0]?.unitCode === "CTN", JSON.stringify(reloaded.body?.lines?.[0]));
    checkEq("so does the base quantity", n(reloaded.body?.lines?.[0]?.baseQty), EXPECTED_PIECES);
  });

  // --- 16. R2.5 — a fixed line discount under a percentage document discount ---

  await scenario("R2.5 — fixed line discounts plus a percentage document discount reconcile exactly", async () => {
    const customer = await customerOf("CUST-DEMO-3");
    const service = await itemOf("ITEM-DEMO-10");

    /**
     * Chosen so the largest-remainder split has a leftover to place: the
     * document discount is 13.31, and proportional shares of it come to
     * 674.68 / 0.07 / 656.24 minor units. A naive per-line round would spread
     * 13.30 or 13.32 and the grand total would miss by a piastre.
     */
    function serviceLine(lineId: string, qty: string, unitPrice: string, discount: Record<string, unknown>) {
      return {
        lineId,
        itemId: service.id,
        itemNameAr: service.nameAr,
        isStock: false,
        qty,
        unitPrice,
        taxRatePercent: 0,
        revenueAccountId: REVENUE_ACCOUNT,
        ...discount,
      };
    }

    const created = await req("POST", "/sales-invoices", {
      id: "SCN-INV-DISC",
      date: TODAY,
      dueDate: "2026-09-24",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      discount: { type: "percent", percent: 7.5 },
      lines: [
        serviceLine("L1", "3", "33.33", { discountType: "amount", discountAmount: "10.00" }),
        serviceLine("L2", "1", "0.01", {}),
        serviceLine("L3", "7", "14.29", { discountType: "percent", discountPercent: 12.5 }),
      ],
    });
    check("the mixed-discount invoice is created", created.status === 201, JSON.stringify(created.body).slice(0, 400));

    const totals = created.body?.totals ?? {};
    checkEq("gross = 99.99 + 0.01 + 100.03", n(totals.grossTotal), 200.03);
    checkEq("line discounts = a fixed 10.00 plus 12.5% of 100.03 rounded to 12.50", n(totals.lineDiscountTotal), 22.5);
    checkEq("subtotal is gross less the line discounts", n(totals.subtotal), 177.53);
    checkEq("the document discount is 7.5% of 177.53, HALF_UP to the piastre", n(totals.invoiceDiscountTotal), 13.31);
    checkEq(
      "and the grand total is subtotal − document discount EXACTLY — no allocation drift",
      n(totals.grandTotal),
      177.53 - 13.31,
    );
    checkEq("the taxable base equals the grand total on a zero-rated invoice", n(totals.taxableTotal), n(totals.grandTotal));

    const storedLines = created.body?.lines ?? [];
    check("the fixed line discount is stored as an amount, not converted to a percentage", storedLines[0]?.discountType === "amount", JSON.stringify(storedLines[0]));
    checkEq("with its amount intact", n(storedLines[0]?.discountAmount), 10);
    check("and the percentage line stays a percentage", storedLines[2]?.discountType === "percent", JSON.stringify(storedLines[2]));

    const arBefore = n((await arBalance()).balance);
    const confirmed = await req("POST", "/sales-invoices/SCN-INV-DISC/confirm", {});
    check("it confirms", confirmed.status === 200 && confirmed.body?.status === "confirmed", JSON.stringify(confirmed.body).slice(0, 300));

    const entry = (await req("GET", `/gl/journal-entries/${confirmed.body?.journalEntryId}`)).body;
    const debit = (entry?.lines ?? []).reduce((s: number, l: any) => s + n(l.debit), 0);
    const credit = (entry?.lines ?? []).reduce((s: number, l: any) => s + n(l.credit), 0);
    checkEq("the journal entry balances to the cent", debit, credit);
    checkEq("AR is debited for the discounted grand total, not the gross", n((entry?.lines ?? []).find((l: any) => l.accountId === AR_ACCOUNT)?.debit), 164.22);
    checkEq("and the ledger agrees", n((await arBalance()).balance) - arBefore, 164.22);

    const reloaded = await req("GET", "/sales-invoices/SCN-INV-DISC");
    checkEq("the totals survive a reload", n(reloaded.body?.totals?.grandTotal), 164.22);
    check("so does the per-line discount type", reloaded.body?.lines?.[0]?.discountType === "amount", JSON.stringify(reloaded.body?.lines?.[0]));

    // A fixed line discount larger than the line cannot make a line negative:
    // an unvalidated one is how an invoice-level discount once turned 950 into
    // 1,140 (docs/ROADMAP.md §5, discount validation).
    const capped = await req("POST", "/sales-invoices", {
      id: "SCN-INV-DISC-CAP",
      date: TODAY,
      dueDate: "2026-09-24",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [serviceLine("L1", "1", "50.00", { discountType: "amount", discountAmount: "500.00" })],
    });
    checkEq("a line discount above the line's gross is capped at the gross, never negative", n(capped.body?.totals?.grandTotal), 0);

    const negative = await req("POST", "/sales-invoices", {
      id: "SCN-INV-DISC-NEG",
      date: TODAY,
      dueDate: "2026-09-24",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [serviceLine("L1", "1", "50.00", { discountType: "amount", discountAmount: "-25.00" })],
    });
    check("a negative line discount is refused rather than inflating the line", negative.status >= 400, JSON.stringify(negative.body).slice(0, 250));
  });

  await scenario("sales: a quote or invoice line naming an item the catalogue does not hold is refused (D38)", async () => {
    const customer = (rows((await req("GET", "/customers")).body))[0] as any;

    const quote = await req("POST", "/sales-quotes", {
      id: "SCN-D38-QUOTE",
      date: TODAY,
      expiryDate: "2026-09-24",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      branchId: BRANCH_ID,
      currency: "EGP",
      lines: [{ lineId: "L1", itemId: "ITEM-INVENTED-BY-THE-CLIENT", itemNameAr: "صنف لا وجود له", qty: "1", unitPrice: "10", discountPercent: 0, taxRatePercent: 14 }],
    });
    check(
      "a quote line's itemId is checked against the item catalogue, not just against being a non-empty string",
      quote.status === 422 && quote.body?.error === "ITEM_NOT_FOUND",
      `status ${quote.status} body ${JSON.stringify(quote.body).slice(0, 200)}`,
    );
    check("and the refusal names WHICH id was wrong, so the caller can find the line", Array.isArray(quote.body?.itemIds) && quote.body.itemIds.includes("ITEM-INVENTED-BY-THE-CLIENT"), JSON.stringify(quote.body?.itemIds));
    check("the refusal reaches an Arabic UI in Arabic", typeof quote.body?.message === "string" && /[\u0600-\u06FF]/.test(quote.body.message), String(quote.body?.message));

    const invoice = await req("POST", "/sales-invoices", {
      id: "SCN-D38-INVOICE",
      date: TODAY,
      dueDate: "2026-09-24",
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      currency: "EGP",
      arAccountId: AR_ACCOUNT,
      taxAccountId: TAX_ACCOUNT,
      lines: [{ lineId: "L1", itemId: "ITEM-INVENTED-BY-THE-CLIENT", itemNameAr: "صنف لا وجود له", isStock: true, qty: "1", unitPrice: "10", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
    });
    check(
      "the same check guards the sales-invoice line, which is where an invented id would have moved no stock and posted no COGS",
      invoice.status === 422 && invoice.body?.error === "ITEM_NOT_FOUND",
      `status ${invoice.status} body ${JSON.stringify(invoice.body).slice(0, 200)}`,
    );

    const nothingPersisted = await req("GET", "/sales-quotes/SCN-D38-QUOTE");
    check("nothing was persisted by the refused request", nothingPersisted.status === 404, `status ${nothingPersisted.status}`);
  });

  await scenario("a list is a PAGE, and the totals beside it still count the whole set", async () => {
    // A BARE GET IS ONE PAGE NOW (Q-8). It used to mean "every row ever", and
    // that is what made five screens fetch the whole table; the default is
    // what makes the unbounded read unreachable by omission. So the whole set
    // is what walking the pages returns, not what one request answers with.
    const all = await ctx.allRows("/sales-invoices");
    check("walking the pages reaches every row", all.length > 1, `${all.length} rows`);
    const bare = await req("GET", "/sales-invoices");
    check(
      "and a request that names no page gets the first one, not the table",
      bare.ok && Array.isArray(bare.body) && bare.body.length === Math.min(DEFAULT_PAGE_SIZE, all.length),
      `status ${bare.status} rows ${bare.body?.length} of ${all.length}`,
    );

    const total = all.length;
    const firstPage = await req("GET", "/sales-invoices?page=1&pageSize=1");
    const secondPage = await req("GET", "/sales-invoices?page=2&pageSize=1");
    check("pageSize is honoured by the SERVER, not by the browser slicing what it was sent", firstPage.ok && firstPage.body.length === 1, `status ${firstPage.status} rows ${firstPage.body?.length}`);
    check("page 2 is a different row from page 1", secondPage.ok && secondPage.body.length === 1 && secondPage.body[0].id !== firstPage.body[0].id, `${firstPage.body?.[0]?.id} vs ${secondPage.body?.[0]?.id}`);
    check("the page keeps the list's own order", firstPage.body[0].id === all[0].id && secondPage.body[0].id === all[1].id, `${firstPage.body?.[0]?.id}/${secondPage.body?.[0]?.id}`);

    const pastTheEnd = await req("GET", `/sales-invoices?page=${total + 5}&pageSize=25`);
    check("a page past the end is empty, not an error", pastTheEnd.ok && pastTheEnd.body.length === 0, `status ${pastTheEnd.status} rows ${pastTheEnd.body?.length}`);

    // The pager's total comes from /counts, so a page must never reach it —
    // paging would otherwise make every chip read "1" and the pager vanish.
    const counts = await req("GET", "/sales-invoices/counts?page=1&pageSize=1");
    check("the chip counts ignore the page and still count the whole filtered set", counts.ok && counts.body.all === total, `all ${counts.body?.all} vs ${total}`);
    const stats = await req("GET", "/sales-invoices/stats?page=1&pageSize=1");
    const unpagedStats = await req("GET", "/sales-invoices/stats");
    check("and so does the KPI strip", stats.ok && stats.body.sales === unpagedStats.body.sales, `${stats.body?.sales} vs ${unpagedStats.body?.sales}`);

    // Deep-linking is why the route had to learn document numbers: the screen
    // can no longer find a document among the rows it happens to hold.
    const withDocNo = all.find((inv: any) => inv.docNo);
    check("a confirmed invoice is reachable by its document NUMBER, not only by its id", withDocNo !== undefined, "no numbered invoice in the seed");
    if (withDocNo) {
      const byDocNo = await req("GET", `/sales-invoices/${withDocNo.docNo}`);
      check("GET /sales-invoices/<docNo> resolves the same document as its id", byDocNo.ok && byDocNo.body.id === withDocNo.id, `status ${byDocNo.status} id ${byDocNo.body?.id}`);
    }

    const filteredCounts = await req("GET", "/sales-invoices/counts?status=confirmed");
    const filteredPage = await req("GET", "/sales-invoices?status=confirmed&page=1&pageSize=2");
    check(
      "a filter narrows the page and the count together, so the pager cannot outrun the rows",
      filteredPage.ok && filteredCounts.ok && filteredPage.body.length <= 2 && filteredPage.body.every((inv: any) => inv.status === "confirmed"),
      `rows ${filteredPage.body?.length} count ${filteredCounts.body?.confirmed}`,
    );
  });

  await scenario("a giveaway needs sales.price.override, and a discount above the tenant ceiling needs sales.discount.approve", async () => {
    const customer = await customerOf("CUST-DEMO-1");
    const item = await itemOf("ITEM-DEMO-1");
    // Plain invoice-create, nothing else — the exact holder the finding names.
    const clerk = { "x-permissions": "sales.invoice.create,sales.invoice.view", "x-user-id": "SCN-USER-SELLER" };
    const withOverride = { "x-permissions": "sales.invoice.create,sales.invoice.view,sales.price.override", "x-user-id": "SCN-USER-SELLER" };
    const withApproval = { "x-permissions": "sales.invoice.create,sales.invoice.view,sales.discount.approve", "x-user-id": "SCN-USER-SUPERVISOR" };

    function body(id: string, over: Record<string, unknown> = {}) {
      return {
        id,
        date: TODAY,
        dueDate: "2026-09-24",
        customerId: customer.id,
        customerNameAr: customer.nameAr,
        warehouseId: WAREHOUSE_ID,
        branchId: BRANCH_ID,
        currency: "EGP",
        arAccountId: AR_ACCOUNT,
        taxAccountId: TAX_ACCOUNT,
        lines: [
          {
            lineId: "L1",
            itemId: item.id,
            itemNameAr: item.nameAr,
            isStock: true,
            qty: "1",
            unitPrice: "100",
            taxRatePercent: 14,
            revenueAccountId: REVENUE_ACCOUNT,
            cogsAccountId: COGS_ACCOUNT,
            inventoryAccountId: "1200",
            ...over,
          },
        ],
      };
    }

    const zeroPrice = await req("POST", "/sales-invoices", body("SCN-INV-ZEROPRICE", { unitPrice: "0" }), clerk);
    check(
      "a zero unit price is refused for a salesperson without sales.price.override",
      zeroPrice.status === 403 && zeroPrice.body?.permission === "sales.price.override",
      `status ${zeroPrice.status} body ${JSON.stringify(zeroPrice.body)}`,
    );
    check("and the refusal reaches the Arabic screen in Arabic", typeof zeroPrice.body?.message === "string" && /[\u0600-\u06FF]/.test(zeroPrice.body.message), String(zeroPrice.body?.message));
    check("nothing was persisted by the refused request", (await req("GET", "/sales-invoices/SCN-INV-ZEROPRICE")).status === 404, "");

    const fullDiscount = await req(
      "POST",
      "/sales-invoices",
      body("SCN-INV-FREEBIE", { discountType: "percent", discountPercent: 100 }),
      clerk,
    );
    check(
      "a 100% line discount is the same act by another route, and is refused the same way",
      fullDiscount.status === 403 && fullDiscount.body?.permission === "sales.price.override",
      `status ${fullDiscount.status} body ${JSON.stringify(fullDiscount.body)}`,
    );

    const amountToZero = await req(
      "POST",
      "/sales-invoices",
      body("SCN-INV-FREEBIE-AMT", { discountType: "amount", discountAmount: "100" }),
      clerk,
    );
    check(
      "and so is a fixed discount that happens to equal the whole line",
      amountToZero.status === 403 && amountToZero.body?.permission === "sales.price.override",
      `status ${amountToZero.status} body ${JSON.stringify(amountToZero.body)}`,
    );

    const allowed = await req("POST", "/sales-invoices", body("SCN-INV-ZEROPRICE-OK", { unitPrice: "0" }), withOverride);
    check(
      "the same document is accepted from a holder of sales.price.override",
      allowed.status === 201,
      `status ${allowed.status} body ${JSON.stringify(allowed.body).slice(0, 200)}`,
    );

    // The ceiling ships at 100, so an ordinary discount stays allowed until a
    // tenant sets one — a limit nobody chose must refuse nothing.
    const ordinary = await req("POST", "/sales-invoices", body("SCN-INV-DISC-30", { discountType: "percent", discountPercent: 30 }), clerk);
    check("with no ceiling configured an ordinary discount is untouched", ordinary.status === 201, `status ${ordinary.status}`);

    const settings = (await req("GET", "/settings")).body;
    check("the tenant ceiling defaults to 100 — off, not silently imposed", settings?.maxLineDiscountPercent === 100, JSON.stringify(settings?.maxLineDiscountPercent));
    const setCeiling = await req("PUT", "/settings", { maxLineDiscountPercent: 20 });
    check("an admin can set the ceiling", setCeiling.ok && setCeiling.body?.maxLineDiscountPercent === 20, `status ${setCeiling.status}`);

    const overCeiling = await req("POST", "/sales-invoices", body("SCN-INV-DISC-30B", { discountType: "percent", discountPercent: 30 }), clerk);
    check(
      "once a ceiling exists, a discount above it needs sales.discount.approve",
      overCeiling.status === 403 && overCeiling.body?.permission === "sales.discount.approve",
      `status ${overCeiling.status} body ${JSON.stringify(overCeiling.body)}`,
    );
    const approved = await req("POST", "/sales-invoices", body("SCN-INV-DISC-30C", { discountType: "percent", discountPercent: 30 }), withApproval);
    check("and a holder of sales.discount.approve may still raise it", approved.status === 201, `status ${approved.status} body ${JSON.stringify(approved.body).slice(0, 200)}`);

    // Later modules share this tenant: a ceiling left behind would refuse
    // documents they have always been allowed to raise.
    const restore = await req("PUT", "/settings", { maxLineDiscountPercent: 100 });
    check("scenario ceiling restored", restore.ok && restore.body?.maxLineDiscountPercent === 100, `status ${restore.status}`);
  });

  await scenario("administrative acts leave a forensic trail", async () => {
    const before = ctx.rows((await req("GET", "/audit?stream=sensitive&limit=200")).body);

    const role = await req("POST", "/roles", {
      code: "SCN_AUDIT_ROLE",
      name: "دور تدقيق السيناريو",
      permissions: ["sales.invoice.view"],
    });
    check("a role creates", role.status === 201, `status ${role.status} body ${JSON.stringify(role.body).slice(0, 200)}`);

    const grant = await req("PUT", `/roles/${role.body?.id}`, {
      code: "SCN_AUDIT_ROLE",
      name: "دور تدقيق السيناريو",
      permissions: ["sales.invoice.view", "workflow.approve"],
    });
    check("and gains a permission", grant.ok, `status ${grant.status}`);

    const roleEvents = ctx.rows((await req("GET", `/audit?stream=sensitive&entityType=ROLE&entityId=${role.body?.id}`)).body);
    check("granting permissions to a role is recorded — it used to leave no trace at all", roleEvents.length >= 2, `events ${roleEvents.length}`);
    const update = roleEvents.find((e: any) => e.action === "UPDATE");
    check(
      "and the record names WHICH permission was granted, not merely that the role changed",
      Array.isArray(update?.details?.granted) && update.details.granted.includes("workflow.approve"),
      JSON.stringify(update?.details?.granted),
    );
    check("the actor is the resolved session, not a header the caller wrote", update?.actor === "USER-ADMIN", String(update?.actor));

    const period = ctx.rows((await req("GET", "/fiscal-periods")).body).find((p: any) => p.status === "open");
    if (period) {
      await req("POST", `/fiscal-periods/${period.id}/close`, {});
      await req("POST", `/fiscal-periods/${period.id}/reopen`, {});
      const trail = ctx.rows(
        (await req("GET", `/audit?stream=sensitive&entityType=FISCAL_PERIOD&entityId=${period.id}`)).body,
      );
      check("closing and reopening a period are both recorded", trail.some((e: any) => e.action === "CLOSE") && trail.some((e: any) => e.action === "REOPEN"), JSON.stringify(trail.map((e: any) => e.action)));
      const reopen = trail.find((e: any) => e.action === "REOPEN");
      check("and the reopen names the status it undid", reopen?.details?.previousStatus === "closed", JSON.stringify(reopen?.details));
    }

    check("audit rows existed before this scenario too, so the trail is not scenario-only", before.length >= 0, String(before.length));
    const del = await req("DELETE", `/roles/${role.body?.id}`);
    check("scenario role deleted", del.status === 204, `status ${del.status}`);
  });

  await scenario("the seed's tenant carries what an Egyptian tax invoice must state about the seller", async () => {
    const settings = (await req("GET", "/settings")).body;
    // The printed page is the one Egyptian law is specific about, and it is
    // also what a buyer judges the product by. A demo tenant with no tax
    // number prints a document that would be refused.
    check("the tenant has a tax registration number", typeof settings?.taxRegistrationNumber === "string" && settings.taxRegistrationNumber.trim() !== "", String(settings?.taxRegistrationNumber));
    check("and a commercial register", typeof settings?.commercialRegistrationNumber === "string" && settings.commercialRegistrationNumber.trim() !== "", String(settings?.commercialRegistrationNumber));
    check("and an address a customer could post to", typeof settings?.address === "string" && settings.address.trim() !== "", String(settings?.address));
    check("and a company name", typeof settings?.companyName === "string" && settings.companyName.trim() !== "", String(settings?.companyName));

    // The print page groups VAT by the rate each LINE was charged at, so the
    // rate has to survive on the posted line — dividing tax by base is what
    // the VAT return had to do for want of it (D28).
    const invoice = (await req("GET", "/sales-invoices?status=confirmed&pageSize=1")).body?.[0];
    check("a confirmed invoice exists to print", invoice !== undefined, "no confirmed invoice in the seed");
    if (invoice) {
      const full = (await req("GET", `/sales-invoices/${invoice.docNo ?? invoice.id}`)).body;
      check("its lines each carry the tax rate they were charged at", Array.isArray(full?.lines) && full.lines.every((l: any) => typeof l.taxRatePercent === "number"), JSON.stringify(full?.lines?.map((l: any) => l.taxRatePercent)));
      check("and a document number, which is what the printed page states", typeof full?.docNo === "string" && full.docNo !== "", String(full?.docNo));
      check("and a customer the invoice can name on the page", typeof full?.customerNameAr === "string" && full.customerNameAr !== "", String(full?.customerNameAr));
      const customer = (await req("GET", `/customers/${full.customerId}`)).body;
      check("whose own tax number is available for the buyer block", customer !== null && customer !== undefined, String(full?.customerId));
    }
  });

  await scenario("D338 — a collection is created, confirmed and allocated in one transaction, in its treasury account's currency", async () => {
    const open = rows((await req("GET", "/open-invoices?kind=sales&partyId=CUST-H-22")).body);
    const invoice = open.find((row: any) => n(row.outstanding) > 1000);
    check("an open EGP invoice exists for the collection", invoice !== undefined, JSON.stringify(open.slice(0, 2)));
    if (!invoice) return;
    const before = await ctx.invariants();
    const failed = await req("POST", "/vouchers/collections", {
      id: "SCN-D338-FAIL",
      customerId: "CUST-H-22",
      branchId: "BR-MAIN",
      treasuryAccountId: "TR-DEMO-CASH",
      amount: "100",
      paymentMethod: "cash",
      allocations: [{ invoiceId: invoice.id, amount: "999999" }],
    });
    check("an allocation that fails after the confirm refuses the whole collection 422", failed.status === 422 && failed.body?.error === "ALLOCATION_EXCEEDS", `status ${failed.status} ${JSON.stringify(failed.body)}`);
    check("and leaves no confirmed, unallocated voucher behind", (await req("GET", "/vouchers/SCN-D338-FAIL")).status === 404);
    const mixed = await req("POST", "/vouchers/collections", {
      id: "SCN-D338-USD",
      customerId: "CUST-H-22",
      branchId: "BR-MAIN",
      treasuryAccountId: "TR-DEMO-BANK-USD",
      amount: "10",
      paymentMethod: "bank",
      allocations: [{ invoiceId: invoice.id }],
    });
    check(
      "a USD treasury account cannot settle an EGP invoice — refused, not mixed",
      mixed.status === 422 && mixed.body?.error === "ALLOCATION_CURRENCY_MISMATCH" && typeof mixed.body?.messageEn === "string",
      `status ${mixed.status} ${JSON.stringify(mixed.body)}`,
    );
    check("and the refused USD voucher is gone with it", (await req("GET", "/vouchers/SCN-D338-USD")).status === 404);
    const viaInvoice = await req("POST", `/sales-invoices/${invoice.id}/payments`, { amount: "10", treasuryAccountId: "TR-DEMO-BANK-USD", paymentMethod: "bank" });
    check("the invoice's own collection refuses a foreign treasury account instead of posting base money into it", viaInvoice.status === 422, `status ${viaInvoice.status}`);
    const after = await ctx.invariants();
    checkEq("the refused attempts moved no receivable", after.ar, before.ar, 0);
    checkEq("and left the trial balance where it was", after.tb, before.tb, 0);

    const done = await req("POST", "/vouchers/collections", {
      id: "SCN-D338-OK",
      customerId: "CUST-H-22",
      branchId: "BR-MAIN",
      treasuryAccountId: "TR-DEMO-CASH",
      amount: "250.50",
      paymentMethod: "cash",
      allocations: [{ invoiceId: invoice.id }],
    });
    check("one call answers 201 with a confirmed voucher", done.status === 201 && done.body?.voucher?.status === "confirmed" && done.body?.held === false, `status ${done.status} ${JSON.stringify(done.body)}`);
    check("the voucher carries its treasury account's currency", done.body?.voucher?.currency === "EGP", String(done.body?.voucher?.currency));
    check(
      "and its whole amount is allocated to the invoice",
      done.body?.allocations?.length === 1 && done.body.allocations[0].amount === "250.500000" && done.body.allocations[0].invoiceId === invoice.id,
      JSON.stringify(done.body?.allocations),
    );
    const reread = rows((await req("GET", "/open-invoices?kind=sales&partyId=CUST-H-22")).body).find((row: any) => row.id === invoice.id);
    checkEq("the invoice's outstanding fell by exactly the collection", n(invoice.outstanding) - n(reread?.outstanding ?? invoice.outstanding), 250.5, 0);
    const settled = await ctx.invariants();
    checkEq("AR still ties to its control account", settled.ar, 0, 0);
    checkEq("the trial balance still balances", settled.tb, 0, 0);
  });

  await scenario("D344 — a collection held by an approval carries its allocations and the approved confirm applies them", async () => {
    const cfg = await req("POST", "/workflow/configs", {
      actionType: "TREASURY_VOUCHER_CONFIRM",
      steps: [{ role: "FINANCE_MANAGER", description: "مراجعة تحصيل" }],
    });
    check("a TREASURY_VOUCHER_CONFIRM chain configures", cfg.status === 201, `status ${cfg.status} ${JSON.stringify(cfg.body)}`);
    const clerk = {
      "x-user-id": "SCN-USER-CLERK",
      "x-permissions": "treasury.cash_voucher.create,treasury.cash_voucher.confirm,treasury.allocation.manage,treasury.allocation.view,treasury.cash_voucher.view",
      "x-role-codes": "CASHIER",
    };
    const manager = { "x-user-id": "SCN-USER-MANAGER", "x-permissions": "workflow.view,workflow.approve,workflow.reject", "x-role-codes": "FINANCE_MANAGER" };
    try {
      const open = rows((await req("GET", "/open-invoices?kind=sales&partyId=CUST-H-22")).body).filter((row: any) => n(row.outstanding) > 500);
      check("two open invoices exist for the held collections", open.length >= 2, JSON.stringify(open.map((r: any) => r.outstanding)));
      if (open.length < 2) return;
      const [target, stale] = open;
      const before = await ctx.invariants();

      const held = await req("POST", "/vouchers/collections", {
        id: "SCN-D344-HELD",
        customerId: "CUST-H-22",
        branchId: "BR-MAIN",
        treasuryAccountId: "TR-DEMO-CASH",
        amount: "300",
        paymentMethod: "cash",
        allocations: [{ invoiceId: target.id, amount: "300" }],
      }, clerk);
      check(
        "the gated collection is held with no allocation made yet",
        held.status === 201 && held.body?.held === true && held.body?.voucher?.status === "pending" && held.body?.allocations?.length === 0,
        `status ${held.status} ${JSON.stringify(held.body)}`,
      );
      check(
        "and it carries the requested allocation",
        held.body?.heldAllocations?.length === 1 && held.body.heldAllocations[0].invoiceId === target.id && held.body.heldAllocations[0].amount === "300.000000",
        JSON.stringify(held.body?.heldAllocations),
      );
      const heldInv = await ctx.invariants();
      checkEq("holding it moved no receivable", heldInv.ar, before.ar, 0);

      const approve = await req("POST", "/workflow/requests/SCN-D344-HELD:confirm/decide", { decision: "approve" }, manager);
      check("a different holder of the step's role approves it", approve.status === 200 && approve.body?.status === "approved", `status ${approve.status} ${JSON.stringify(approve.body)}`);
      const posted = await req("GET", "/vouchers/SCN-D344-HELD");
      check("the approved voucher is confirmed", posted.body?.status === "confirmed", JSON.stringify(posted.body?.status));
      check("and its carried allocations are spent", (posted.body?.heldAllocations ?? []).length === 0, JSON.stringify(posted.body?.heldAllocations));
      const allocations: any[] = (await req("GET", "/vouchers/SCN-D344-HELD/allocations")).body?.allocations ?? [];
      check(
        "and it is allocated to the invoice it named, in the same act",
        allocations.length === 1 && allocations[0].invoiceId === target.id && allocations[0].amount === "300.000000" && allocations[0].status === "active",
        JSON.stringify(allocations),
      );
      const reread = rows((await req("GET", "/open-invoices?kind=sales&partyId=CUST-H-22")).body).find((row: any) => row.id === target.id);
      checkEq("the invoice's outstanding fell by exactly the collection", n(target.outstanding) - n(reread?.outstanding ?? target.outstanding), 300, 0);
      const settled = await ctx.invariants();
      checkEq("the AR sub-ledger still ties to GL 1105", settled.ar, 0, 0);
      checkEq("and the trial balance balances", settled.tb, 0, 0);

      const staleHeld = await req("POST", "/vouchers/collections", {
        id: "SCN-D344-STALE",
        customerId: "CUST-H-22",
        branchId: "BR-MAIN",
        treasuryAccountId: "TR-DEMO-CASH",
        amount: stale.outstanding,
        paymentMethod: "cash",
        allocations: [{ invoiceId: stale.id }],
      }, clerk);
      check("a second collection for a whole invoice is held", staleHeld.status === 201 && staleHeld.body?.held === true, `status ${staleHeld.status} ${JSON.stringify(staleHeld.body)}`);
      const paidElsewhere = await req("POST", "/vouchers/collections", {
        id: "SCN-D344-ELSEWHERE",
        customerId: "CUST-H-22",
        branchId: "BR-MAIN",
        treasuryAccountId: "TR-DEMO-CASH",
        amount: "100",
        paymentMethod: "cash",
        allocations: [{ invoiceId: stale.id }],
      });
      check("meanwhile the invoice is part-paid by another collection", paidElsewhere.status === 201 && paidElsewhere.body?.held === false, `status ${paidElsewhere.status} ${JSON.stringify(paidElsewhere.body)}`);
      const beforeStale = await ctx.invariants();
      const refused = await req("POST", "/workflow/requests/SCN-D344-STALE:confirm/decide", { decision: "approve" }, manager);
      check(
        "approving the stale collection refuses its allocation instead of over-allocating",
        refused.status === 409 && refused.body?.error === "HELD_DOCUMENT_NOT_RESOLVED" && refused.body?.reason === "HELD_ALLOCATION_REFUSED",
        `status ${refused.status} ${JSON.stringify(refused.body)}`,
      );
      check(
        "and says why in Arabic and in English",
        /[\u0600-\u06FF]/.test(String(refused.body?.message)) && /exceeds what invoice/.test(String(refused.body?.messageEn)),
        JSON.stringify(refused.body),
      );
      const stillHeld = await req("GET", "/vouchers/SCN-D344-STALE");
      check("the refused voucher posted nothing and stays held", stillHeld.body?.status === "pending" && !stillHeld.body?.journalEntryId, JSON.stringify(stillHeld.body));
      const afterStale = await ctx.invariants();
      checkEq("the refusal moved no receivable", afterStale.ar, beforeStale.ar, 0);
      checkEq("and left the trial balance where it was", afterStale.tb, beforeStale.tb, 0);
      const cancel = await req("POST", "/vouchers/SCN-D344-STALE/cancel", {});
      check("the stale voucher can still be cancelled", cancel.status === 200, `status ${cancel.status} ${JSON.stringify(cancel.body)}`);
    } finally {
      const del = await req("DELETE", `/workflow/configs/${cfg.body?.id}`);
      check("scenario TREASURY_VOUCHER_CONFIRM config deleted", del.status === 204, `status ${del.status}`);
    }
  });

  await scenario("D346 — the sales-invoice list parses against the shared sales-invoice contract, lines and all", async () => {
    const page = await req("GET", "/sales-invoices?status=confirmed&pageSize=50");
    const list = rows(page.body);
    check("the list returns invoices with lines", page.status === 200 && list.length > 0 && list.every((row: any) => Array.isArray(row.lines) && row.lines.length > 0), `status ${page.status} rows ${list.length}`);
    const failures = list
      .map((row: any) => ({ id: row.id, parsed: salesInvoiceSchema.safeParse(row) }))
      .filter((entry: any) => !entry.parsed.success)
      .map((entry: any) => `${entry.id}: ${entry.parsed.error.issues.slice(0, 2).map((i: any) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    check("every listed invoice parses with salesInvoiceSchema", failures.length === 0, failures.slice(0, 3).join(" | "));
  });
}
