import type { Ctx } from "./harness.js";

/**
 * Executable checks for the sales parity slice — R3.8 (customer advanced
 * options), R3.9 (the sales-return refund), R3.11 (price-list minimum-quantity
 * tiers), R3.12 (promotion caps and thresholds) and R3.13 (the van registry
 * cascade).
 *
 * Runs after `sales`, so every id here is prefixed `SCP-` and cannot collide
 * with the seed or with a document another suite created ahead of it.
 */

const BRANCH_ID = "BR-MAIN";
const WAREHOUSE_ID = "WH-MAIN";
const AR_ACCOUNT = "1105";
const TAX_ACCOUNT = "2200";
const CASH_ACCOUNT = "1110";
const TODAY = "2026-08-24";

export async function run(ctx: Ctx): Promise<void> {
  const { req, rows, n, check, checkEq, scenario } = ctx;

  async function glBalance(accountId: string): Promise<number> {
    const res = await req("GET", `/gl/accounts/${accountId}/ledger`);
    return n(res.body?.balance?.balance ?? res.body?.balance ?? 0);
  }

  // ---------------------------------------------------------------- R3.11

  await scenario("R3.11 · a minimum-quantity tier changes the price the invoice takes", async () => {
    const list = (await req("GET", "/price-lists/PL-DEMO-2")).body;
    const tiers = (list?.lines ?? []).filter((l: any) => l.itemId === "ITEM-DEMO-1");
    check("the wholesale list quotes ITEM-DEMO-1 at three thresholds", tiers.length === 3, JSON.stringify(tiers));

    const at = async (qty: string) =>
      (await req("POST", "/price-lists/resolve-price", {
        priceListId: "PL-DEMO-2",
        itemId: "ITEM-DEMO-1",
        fallback: "180",
        qty,
      })).body;

    const one = await at("1");
    const twelve = await at("12");
    const sixty = await at("60");
    checkEq("one unit takes the from-1 tier", n(one.price), 168);
    checkEq("twelve units take the from-10 tier", n(twelve.price), 158);
    checkEq("sixty units take the from-50 tier", n(sixty.price), 148);
    check("and the response names the threshold it applied", twelve.tierMinQty === "10.000000", JSON.stringify(twelve));

    // The customer's own list is resolved SERVER-side: the caller names the
    // customer, never the list.
    const byCustomer = (await req("POST", "/price-lists/resolve-price", {
      customerId: "CUST-DEMO-2",
      itemId: "ITEM-DEMO-1",
      fallback: "180",
      qty: "60",
    })).body;
    checkEq("resolving by customer finds the same tier", n(byCustomer.price), 148);
    check("and reports which list it used", byCustomer.priceListId === "PL-DEMO-2", JSON.stringify(byCustomer));

    // What the invoice DOES with the tier: charging 148 is below the list at
    // qty 1 (168) and exactly on it at qty 60, so the pricing check flags the
    // first and not the second. Same price, same customer, same item — the
    // quantity is the only thing that moved.
    const item = (await req("GET", "/items/ITEM-DEMO-1")).body;
    const customer = (await req("GET", "/customers/CUST-DEMO-2")).body;
    const invoiceAt = async (id: string, qty: string) => {
      await req("POST", "/sales-invoices", {
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
            qty,
            unitPrice: "148.00",
            taxRatePercent: 0,
            revenueAccountId: item.revenueAccountId,
            cogsAccountId: item.cogsAccountId,
            inventoryAccountId: item.inventoryAccountId,
          },
        ],
      });
      return (await req("POST", `/sales-invoices/${id}/confirm`, {})).body;
    };

    const small = await invoiceAt("SCP-INV-TIER-1", "1");
    check(
      "charging 148 for a single unit is flagged against the from-1 tier",
      (small?.pricingVariances ?? []).length === 1 && n(small.pricingVariances[0].listPrice) === 168,
      JSON.stringify(small?.pricingVariances),
    );

    const bulk = await invoiceAt("SCP-INV-TIER-2", "60");
    check(
      "the same price for sixty units is not flagged — the from-50 tier is what it is measured against",
      (bulk?.pricingVariances ?? []).length === 0,
      JSON.stringify(bulk?.pricingVariances),
    );
  });

  // ---------------------------------------------------------------- R3.12

  await scenario("R3.12 · a promotion's cap binds and its parts still sum to the total", async () => {
    const cart = (unitPrice: string, qty: string) => ({
      lines: [{ lineId: "L1", itemId: "ITEM-DEMO-1", qty, unitPrice }],
      couponCode: "BULK15",
      date: TODAY,
    });

    // 15% of 30 × 200.00 = 900.00, but the campaign may only give away 500.00.
    const capped = (await req("POST", "/promotions/evaluate", cart("200.00", "30"))).body;
    check("the coupon-gated bulk promotion applies", capped?.applicable === true, JSON.stringify(capped).slice(0, 200));
    checkEq("and its discount stops at the cap, not at 15%", n(capped?.discountTotal), 500);
    checkEq(
      "the per-line parts sum EXACTLY to the capped total",
      (capped?.lineDiscounts ?? []).reduce((s: number, d: any) => s + n(d.amount), 0),
      500,
      0,
    );

    // Below the cap the type's own arithmetic is untouched.
    const under = (await req("POST", "/promotions/evaluate", cart("100.00", "20"))).body;
    checkEq("under the cap the full percentage still applies", n(under?.discountTotal), 300);

    // The minimum quantity is a threshold, not a suggestion.
    const short = (await req("POST", "/promotions/evaluate", cart("200.00", "19"))).body;
    check(
      "nineteen units miss the twenty-unit threshold and the promotion does not apply",
      short?.applicable !== true || short?.promotion?.code !== "BULK15",
      JSON.stringify(short).slice(0, 200),
    );

    // A cap on free goods would let the document exceed its own cap, so the
    // domain refuses the combination rather than pretending to honour it.
    const refused = await req("POST", "/promotions", {
      id: "SCP-PROMO-BAD",
      code: "SCP-BAD",
      nameAr: "عرض غير صالح",
      type: "buy_x_get_y",
      buyQty: 2,
      getQty: 1,
      maxDiscountAmount: "100",
      startDate: TODAY,
      endDate: "2026-12-31",
    });
    check("a cap on a buy-X-get-Y promotion is refused", refused.status >= 400, JSON.stringify(refused.body).slice(0, 200));

    // The bundle campaign prices the whole combination, not each line.
    const bundle = (await req("POST", "/promotions/evaluate", {
      lines: [
        { lineId: "L1", itemId: "ITEM-DEMO-1", qty: "1", unitPrice: "180.00" },
        { lineId: "L2", itemId: "ITEM-DEMO-2", qty: "2", unitPrice: "95.00" },
      ],
      couponCode: "COMBO",
      date: TODAY,
    })).body;
    check("the bundle applies when every component is present", bundle?.promotion?.code === "COMBO", JSON.stringify(bundle).slice(0, 200));
    checkEq("and discounts the difference down to the bundle price", n(bundle?.discountTotal), 70);
  });

  // ---------------------------------------------------------------- R3.9

  await scenario("R3.9 · refunding a sales return moves the ledger and the treasury together", async () => {
    const item = (await req("GET", "/items/ITEM-DEMO-1")).body;
    const customer = (await req("GET", "/customers/CUST-DEMO-1")).body;

    await req("POST", "/sales-invoices", {
      id: "SCP-INV-RET",
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
          qty: "4",
          unitPrice: "200.00",
          taxRatePercent: 0,
          revenueAccountId: item.revenueAccountId,
          cogsAccountId: item.cogsAccountId,
          inventoryAccountId: item.inventoryAccountId,
        },
      ],
    });
    await req("POST", "/sales-invoices/SCP-INV-RET/confirm", {});

    const created = await req("POST", "/sales-returns/from-invoice", {
      id: "SCP-RET-1",
      date: TODAY,
      memo: "مرتجع للاختبار",
      sourceInvoiceId: "SCP-INV-RET",
      warehouseId: WAREHOUSE_ID,
      reason: "DEFECTIVE",
      requested: [{ itemId: item.id, qty: "2" }],
    });
    check("the return builds from its source invoice", created.status === 201, JSON.stringify(created.body).slice(0, 200));
    await req("POST", "/sales-returns/SCP-RET-1/confirm", {});

    const confirmed = (await req("GET", "/sales-returns/SCP-RET-1")).body;
    check("a confirmed return is awaiting its refund", confirmed?.awaitingRefund === true, JSON.stringify(confirmed?.awaitingRefund));
    checkEq("and it owes the customer the line's value", n(confirmed?.refundDue), 400);

    const arBefore = await glBalance(AR_ACCOUNT);
    const cashBefore = await glBalance(CASH_ACCOUNT);

    const refund = await req("POST", "/sales-returns/SCP-RET-1/refund", {
      amount: "400.00",
      treasuryAccountId: "TR-DEMO-CASH",
      paymentMethod: "cash",
      date: TODAY,
    });
    check("the refund succeeds", refund.status === 200, JSON.stringify(refund.body).slice(0, 250));
    check("and names the voucher it created", typeof refund.body?.voucherNo === "string", JSON.stringify(refund.body?.voucherNo));

    const voucher = (await req("GET", `/vouchers/${refund.body?.voucherId}`)).body;
    check("the voucher is a real confirmed رد مبلغ لعميل", voucher?.status === "confirmed" && voucher?.voucherType === "customer_refund", JSON.stringify({ s: voucher?.status, t: voucher?.voucherType }));
    check("it posted a journal entry", typeof voucher?.journalEntryId === "string" && voucher.journalEntryId.length > 0, JSON.stringify(voucher?.journalEntryId));

    const entry = (await req("GET", `/gl/entries/${voucher?.journalEntryId}`)).body;
    const debit = rows(entry?.lines).reduce((s: number, l: any) => s + n(l.debit), 0);
    const credit = rows(entry?.lines).reduce((s: number, l: any) => s + n(l.credit), 0);
    checkEq("the entry balances to the cent", debit, credit, 0);
    checkEq("it moves the refunded amount", debit, 400);

    checkEq("AR falls by the refund — the credit note is settled", await glBalance(AR_ACCOUNT), arBefore - 400);
    checkEq("cash falls by the same amount", await glBalance(CASH_ACCOUNT), cashBefore - 400);

    const settled = (await req("GET", "/sales-returns/SCP-RET-1")).body;
    check("the return is no longer awaiting a refund", settled?.awaitingRefund === false, JSON.stringify(settled?.awaitingRefund));
    checkEq("and nothing is left to refund", n(settled?.refundDue), 0);
    checkEq("what was refunded is recorded", n(settled?.refundedTotal), 400);

    // Refunding twice would pay the same credit note twice.
    const again = await req("POST", "/sales-returns/SCP-RET-1/refund", {
      amount: "400.00",
      treasuryAccountId: "TR-DEMO-CASH",
      paymentMethod: "cash",
      date: TODAY,
    });
    check("a second refund beyond what is owed is refused", again.status >= 400, JSON.stringify(again.body).slice(0, 200));

    // The reverse must restore BOTH sides, not just the flag.
    const reversed = await req("POST", `/vouchers/${refund.body?.voucherId}/reverse`, { reversalId: "SCP-RET-1-REV" });
    check("the refund voucher reverses", reversed.status === 200, JSON.stringify(reversed.body).slice(0, 200));
    checkEq("AR is restored", await glBalance(AR_ACCOUNT), arBefore);
    checkEq("cash is restored", await glBalance(CASH_ACCOUNT), cashBefore);

    const reopened = (await req("GET", "/sales-returns/SCP-RET-1")).body;
    check("and the return is awaiting its refund again", reopened?.awaitingRefund === true, JSON.stringify(reopened?.awaitingRefund));
    checkEq("with the full amount owed once more", n(reopened?.refundDue), 400);

    // Never trust a number the caller supplied: the refundable amount is
    // recomputed from the posted return, not read off the request.
    const overpay = await req("POST", "/sales-returns/SCP-RET-1/refund", {
      amount: "9999.00",
      treasuryAccountId: "TR-DEMO-CASH",
      paymentMethod: "cash",
      date: TODAY,
    });
    check("a refund larger than the return is refused", overpay.status >= 400, JSON.stringify(overpay.body).slice(0, 200));
  });

  await scenario("R3.9 · a return carries a reason per line, not one for the document", async () => {
    const item = (await req("GET", "/items/ITEM-DEMO-2")).body;
    const customer = (await req("GET", "/customers/CUST-DEMO-1")).body;
    const other = (await req("GET", "/items/ITEM-DEMO-3")).body;

    await req("POST", "/sales-invoices", {
      id: "SCP-INV-REASONS",
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
          qty: "3",
          unitPrice: "95.00",
          taxRatePercent: 0,
          revenueAccountId: item.revenueAccountId,
          cogsAccountId: item.cogsAccountId,
          inventoryAccountId: item.inventoryAccountId,
        },
        {
          lineId: "L2",
          itemId: other.id,
          itemNameAr: other.nameAr,
          isStock: true,
          qty: "3",
          unitPrice: "42.00",
          taxRatePercent: 0,
          revenueAccountId: other.revenueAccountId,
          cogsAccountId: other.cogsAccountId,
          inventoryAccountId: other.inventoryAccountId,
        },
      ],
    });
    await req("POST", "/sales-invoices/SCP-INV-REASONS/confirm", {});

    const built = await req("POST", "/sales-returns/from-invoice", {
      id: "SCP-RET-REASONS",
      date: TODAY,
      memo: "",
      sourceInvoiceId: "SCP-INV-REASONS",
      warehouseId: WAREHOUSE_ID,
      reason: "OTHER",
      requested: [
        { itemId: item.id, qty: "1", reason: "DEFECTIVE" },
        { itemId: other.id, qty: "1", reason: "WRONG_ITEM" },
      ],
    });
    check("the return is created", built.status === 201, JSON.stringify(built.body).slice(0, 200));
    const byItem = new Map((built.body?.lines ?? []).map((l: any) => [l.itemId, l.reason]));
    check("the first line keeps its own reason", byItem.get(item.id) === "DEFECTIVE", JSON.stringify([...byItem]));
    check("and the second keeps a different one", byItem.get(other.id) === "WRONG_ITEM", JSON.stringify([...byItem]));

    // Never trust a number the caller supplied — the returnable quantity is
    // recomputed from the invoice minus what earlier returns already took.
    const greedy = await req("POST", "/sales-returns/from-invoice", {
      id: "SCP-RET-GREEDY",
      date: TODAY,
      memo: "",
      sourceInvoiceId: "SCP-INV-REASONS",
      warehouseId: WAREHOUSE_ID,
      reason: "OTHER",
      requested: [{ itemId: item.id, qty: "99" }],
    });
    check("returning more than was sold is refused", greedy.status >= 400, JSON.stringify(greedy.body).slice(0, 200));
  });

  // ---------------------------------------------------------------- R3.8

  await scenario("R3.8 · a customer's advanced options persist and bind to real entities", async () => {
    const created = await req("POST", "/customers", {
      id: "SCP-CUST-1",
      code: "SCP-C-1",
      nameAr: "شركة الاختبار المحدودة",
      nameEn: "Test Trading Co.",
      priceListId: "PL-DEMO-2",
      taxNumber: "300123456789",
      commercialRegistrationNumber: "CR-889900",
      taxExempt: true,
      etaBuyerType: "business",
      contactPerson: "منى عبد الرحمن",
      address: "٣ شارع الجمهورية، وسط البلد، القاهرة",
      logoUrl: null,
    });
    check("the customer is created", created.status === 201, JSON.stringify(created.body).slice(0, 250));

    const reloaded = (await req("GET", "/customers/SCP-CUST-1")).body;
    check("the commercial registration survives the round trip", reloaded?.commercialRegistrationNumber === "CR-889900", JSON.stringify(reloaded?.commercialRegistrationNumber));
    check("so does the address", typeof reloaded?.address === "string" && reloaded.address.includes("الجمهورية"), JSON.stringify(reloaded?.address));
    check("the tax-exempt flag is stored", reloaded?.taxExempt === true, JSON.stringify(reloaded?.taxExempt));
    check("the entity type is stored", reloaded?.etaBuyerType === "business", JSON.stringify(reloaded?.etaBuyerType));
    check("the contact person is stored", reloaded?.contactPerson === "منى عبد الرحمن", JSON.stringify(reloaded?.contactPerson));

    // The price list is an ENTITY reference, not a label: the stored id must
    // resolve against /price-lists.
    const list = await req("GET", `/price-lists/${reloaded?.priceListId}`);
    check("the stored price-list id is a real price list", list.status === 200 && list.body?.code === "PL-WHOLESALE", JSON.stringify(list.body?.code));

    const bogus = await req("POST", "/customers", {
      id: "SCP-CUST-2",
      code: "SCP-C-2",
      nameAr: "عميل بقائمة وهمية",
      priceListId: "NOT-A-REAL-LIST",
    });
    check("a price-list id that names nothing is refused", bogus.status >= 400, JSON.stringify(bogus.body).slice(0, 200));
  });

  // ---------------------------------------------------------------- R3.13

  await scenario("R3.13 · choosing a van decides its warehouse and its till", async () => {
    const vans = rows((await req("GET", "/field/vans")).body);
    check("the van registry is populated", vans.length > 0, `${vans.length} vans`);
    const van = vans[0];
    check("a van names its own warehouse", typeof van?.warehouseId === "string" && van.warehouseId.length > 0, JSON.stringify(van));
    check("and its own till", typeof van?.treasuryAccountId === "string" && van.treasuryAccountId.length > 0, JSON.stringify(van));

    const warehouse = await req("GET", `/warehouses/${van.warehouseId}`);
    check("the van's warehouse is a real warehouse", warehouse.status === 200, JSON.stringify(warehouse.body).slice(0, 160));
    const till = await req("GET", `/treasury-accounts/${van.treasuryAccountId}`);
    check("the van's till is a real treasury account", till.status === 200, JSON.stringify(till.body).slice(0, 160));

    const employees = rows((await req("GET", "/hr/employees")).body);
    const driver = employees[0];
    const rep = employees[1] ?? employees[0];

    // The cascade is enforced SERVER-side: a client that names the van but
    // sends someone else's warehouse is refused, not quietly believed.
    const mismatched = await req("POST", "/field/van-trips", {
      id: "SCP-TRIP-BAD",
      date: TODAY,
      branchId: BRANCH_ID,
      vanId: van.id,
      vanWarehouseId: WAREHOUSE_ID,
      vanTreasuryAccountId: van.treasuryAccountId,
      sourceWarehouseId: WAREHOUSE_ID,
      sourceTreasuryAccountId: "TR-DEMO-CASH",
      openingCashFloat: "0",
      crew: [{ employeeId: driver.id, role: "driver" }],
    });
    check("a trip whose warehouse contradicts its van is refused", mismatched.status >= 400, JSON.stringify(mismatched.body).slice(0, 220));

    // Naming the van alone is enough — the server fills both sides in.
    const opened = await req("POST", "/field/van-trips", {
      id: "SCP-TRIP-1",
      date: TODAY,
      branchId: BRANCH_ID,
      vanId: van.id,
      sourceWarehouseId: WAREHOUSE_ID,
      sourceTreasuryAccountId: "TR-DEMO-CASH",
      openingCashFloat: "1000",
      crew: [
        { employeeId: driver.id, role: "driver" },
        { employeeId: rep.id, role: "rep" },
      ],
    });
    check("a trip opens from the van alone", opened.status === 201, JSON.stringify(opened.body).slice(0, 250));
    check("and takes the van's warehouse", opened.body?.vanWarehouseId === van.warehouseId, JSON.stringify(opened.body?.vanWarehouseId));
    check("and the van's till", opened.body?.vanTreasuryAccountId === van.treasuryAccountId, JSON.stringify(opened.body?.vanTreasuryAccountId));
    check("the crew keeps its roles", (opened.body?.crew ?? []).some((c: any) => c.role === "driver"), JSON.stringify(opened.body?.crew));

    // Every crew member must be a real employee — a typed id is the defect
    // this registry exists to close.
    const invented = await req("POST", "/field/van-trips", {
      id: "SCP-TRIP-INVENTED",
      date: TODAY,
      branchId: BRANCH_ID,
      vanId: van.id,
      sourceWarehouseId: WAREHOUSE_ID,
      sourceTreasuryAccountId: "TR-DEMO-CASH",
      openingCashFloat: "0",
      crew: [{ employeeId: "EMP-WHO-KNOWS", role: "driver" }],
    });
    check("a crew member who is not an employee is refused", invented.status >= 400, JSON.stringify(invented.body).slice(0, 220));
  });
}
