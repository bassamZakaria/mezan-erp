import type { Ctx } from "./harness.js";

/**
 * Executable checks for the sales module — docs/scenarios/01-sales.md as code.
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
    // amountPaid and post nothing (docs/defects.md D1).
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
    check("amountPaid reflects VCH-DEMO-1's Treasury-voucher collection (docs/defects.md D1 — the regression guard)", n(invoice.amountPaid) > 0, JSON.stringify(invoice.amountPaid));

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
    // 1,140 (docs/defects.md, discount validation).
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
}
