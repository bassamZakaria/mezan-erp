import type { ScenarioFragment } from "./fragments.js";

const BRANCH = "BR-MAIN";
const MAIN_WH = "WH-MAIN";
const MAIN_TILL = "TR-DEMO-CASH";
const CUSTOMER = "CUST-DEMO-1";
const VAN_GL = "1300-SCN-VR";
const VAN_TILL = "TR-SCN-VR";
const VAN_WH = "WH-SCN-VR";
const VAN = "VAN-SCN-VR";
const TRIP = "SCN-VR-TRIP";
const ITEM_SHORT = "SCN-VR-ITEM-A";
const ITEM_OVER = "SCN-VR-ITEM-B";
const COST_SHORT = 40;
const COST_OVER = 25;
const FLOAT = 500;
const SETTLER = { "x-user-id": "SCN-VR-SETTLER", "x-permissions": "*" };
const SUPERVISOR = { "x-user-id": "SCN-VR-SUPERVISOR", "x-permissions": "*" };

const SHORTAGE_ACCOUNT = "5073";
const COUNT_GAIN_ACCOUNT = "5074";
const CASH_SHORT_ACCOUNT = "5900";

/**
 * Van reconciliation (ENH-E3-04) — a whole trip on a van of its own, so the
 * van's warehouse and till start empty and «ends at zero» is provable: load,
 * sell, take a return, collect into the van till, settle a count that is one
 * short on one item and one over on another with 20.00 missing from the till,
 * and have a second person approve it.
 */
export const scenario: ScenarioFragment = {
  smokePaths: ["/field/van-trips", "/field/vans"],

  async run(ctx) {
    const { scenario: it, req, n, check, checkEq, today } = ctx;
    const same = (label: string, actual: unknown, expected: unknown) => check(label, actual === expected, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
    const gl = async (code: string) => n((await req("GET", `/gl/accounts/${code}/ledger`)).body?.balance?.balance);
    const stock = async (itemId: string, warehouseId: string) => {
      const b = (await req("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${warehouseId}`)).body;
      return { onHand: n(b?.onHand), averageCost: n(b?.averageCost), totalValue: n(b?.totalValue) };
    };
    const tillOf = async (id: string) => gl(String((await req("GET", `/treasury-accounts/${id}`)).body?.glAccountId));

    await it("van reconciliation · a trip settles to zero on the van and posts its shortage, overage and cash variance at the van's cost", async () => {
      checkEq(
        "a GL leaf for the van's cash box is opened",
        (await req("POST", "/accounts", { id: VAN_GL, code: VAN_GL, nameAr: "صندوق عربة السيناريو", nameEn: "Scenario van cash", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false })).status,
        201,
      );
      checkEq(
        "a till on it",
        (await req("POST", "/treasury-accounts", { id: VAN_TILL, code: "CASH-SCN-VR", name: "عهدة عربة السيناريو", nameEn: "Scenario van till", type: "cash", currency: "EGP", branchId: BRANCH, glAccountId: VAN_GL })).status,
        201,
      );
      checkEq("a van warehouse", (await req("POST", "/warehouses", { id: VAN_WH, code: "WH-SCN-VR", name: "عربة السيناريو", nameEn: "Scenario van", branchId: BRANCH, type: "VAN" })).status, 201);
      checkEq(
        "and the van that owns both",
        (await req("POST", "/field/vans", { id: VAN, code: "VAN-SCN-VR", nameAr: "مركبة السيناريو", plateNumber: "س ن ر 4321", branchId: BRANCH, warehouseId: VAN_WH, treasuryAccountId: VAN_TILL })).status,
        201,
      );
      for (const [id, code, nameAr, cost, qty] of [
        [ITEM_SHORT, "SCN-VR-A", "صنف عجز الرحلة", COST_SHORT, "100"],
        [ITEM_OVER, "SCN-VR-B", "صنف زيادة الرحلة", COST_OVER, "50"],
      ] as const) {
        const item = await req("POST", "/items", { id, code, nameAr, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" });
        checkEq(`item ${code} is created`, item.status, 201);
        await req("POST", "/inventory/stock-adjustments/draft", {
          id: `SCN-VR-OPEN-${code}`,
          date: today,
          lines: [{ itemId: id, warehouseId: MAIN_WH, reason: "INITIAL_STOCK", direction: "IN", qty, unitCost: String(cost) }],
        });
        const opened = await req("POST", `/inventory/stock-adjustments/SCN-VR-OPEN-${code}/confirm`, {});
        check(`and stocked in the main warehouse at ${cost}`, opened.ok, JSON.stringify(opened.body).slice(0, 200));
      }

      const mainTillBefore = await tillOf(MAIN_TILL);
      const mainShortBefore = await stock(ITEM_SHORT, MAIN_WH);
      const mainOverBefore = await stock(ITEM_OVER, MAIN_WH);
      const employees = ctx.rows((await req("GET", "/hr/employees")).body);
      const crew = [
        { employeeId: employees[0]?.id, role: "driver" },
        { employeeId: (employees[1] ?? employees[0])?.id, role: "rep" },
      ];

      const opened = await req("POST", "/field/van-trips", {
        id: TRIP,
        date: today,
        vanId: VAN,
        sourceWarehouseId: MAIN_WH,
        sourceTreasuryAccountId: MAIN_TILL,
        openingCashFloat: String(FLOAT),
        crew,
        loadedStock: [
          { itemId: ITEM_SHORT, qty: "20" },
          { itemId: ITEM_OVER, qty: "10" },
        ],
      });
      checkEq("the trip opens", opened.status, 201);
      if (opened.status !== 201) {
        check("trip body", false, JSON.stringify(opened.body).slice(0, 300));
        return;
      }
      checkEq("the load leaves the main warehouse", mainShortBefore.onHand - (await stock(ITEM_SHORT, MAIN_WH)).onHand, 20);
      const vanLoaded = await stock(ITEM_SHORT, VAN_WH);
      checkEq("and lands on the van", vanLoaded.onHand, 20);
      checkEq("at the main warehouse's cost", vanLoaded.averageCost, COST_SHORT);
      checkEq("the float leaves the main till", mainTillBefore - (await tillOf(MAIN_TILL)), FLOAT);
      checkEq("and sits in the van till", await gl(VAN_GL), FLOAT);

      const invoice = await req("POST", "/sales-invoices", {
        id: "SCN-VR-INV",
        date: today,
        dueDate: today,
        customerId: CUSTOMER,
        customerNameAr: "عميل الرحلة",
        warehouseId: VAN_WH,
        branchId: BRANCH,
        currency: "EGP",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [{ lineId: "SCN-VR-INV-L1", itemId: ITEM_SHORT, itemNameAr: "صنف عجز الرحلة", isStock: true, qty: "5", unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
      });
      checkEq("a van invoice is raised", invoice.status, 201);
      const confirmedInvoice = await req("POST", "/sales-invoices/SCN-VR-INV/confirm", {});
      check("and confirmed from the van", confirmedInvoice.ok && confirmedInvoice.body?.held !== true, JSON.stringify(confirmedInvoice.body).slice(0, 200));
      const sold = (await req("GET", "/sales-invoices/SCN-VR-INV")).body;
      checkEq("for 5 × 100 + 14% VAT", n(sold?.totals?.grandTotal), 570);

      const returned = await req("POST", "/sales-returns", {
        id: "SCN-VR-RET",
        date: today,
        memo: "مرتجع على العربة",
        lines: [{
          itemId: ITEM_SHORT,
          warehouseId: VAN_WH,
          customerId: CUSTOMER,
          sourceInvoiceId: "SCN-VR-INV",
          sourceInvoiceNumber: sold?.docNo ?? null,
          reason: "DEFECTIVE",
          availableQty: "5",
          qty: "1",
          unitPrice: "100",
          unitCost: sold?.lines?.[0]?.unitCost ?? String(COST_SHORT),
          taxAmount: "14.00",
        }],
      });
      checkEq("one unit comes back onto the van", returned.status, 201);
      const confirmedReturn = await req("POST", "/sales-returns/SCN-VR-RET/confirm", {});
      same("and the return posts", confirmedReturn.body?.document?.status, "confirmed");

      const collected = await req("POST", "/vouchers/collections", {
        id: "SCN-VR-RCPT",
        customerId: CUSTOMER,
        branchId: BRANCH,
        treasuryAccountId: VAN_TILL,
        amount: "456",
        paymentMethod: "cash",
        allocations: [{ invoiceId: "SCN-VR-INV", amount: "456" }],
      });
      check("the customer pays the 456.00 still owed into the van till", collected.status === 201 && collected.body?.held === false, `status ${collected.status} ${JSON.stringify(collected.body).slice(0, 200)}`);
      checkEq("the van till now holds float + collection", await gl(VAN_GL), FLOAT + 456);

      const expected = (await req("GET", `/field/van-trips/${TRIP}/expected`)).body;
      const line = (itemId: string) => (expected?.lines ?? []).find((l: any) => l.itemId === itemId);
      checkEq("expected cash is the van till's book balance", n(expected?.expectedCash), 956);
      checkEq("of which the float", n(expected?.cashBreakdown?.openingFloat), FLOAT);
      checkEq("and the collection voucher", n(expected?.cashBreakdown?.voucherCollections), 456);
      checkEq("nothing unexplained", n(expected?.cashBreakdown?.other), 0);
      checkEq("expected stock of the sold item is 20 − 5 + 1", n(line(ITEM_SHORT)?.expectedQty), 16);
      checkEq("broken down as 5 sold", n(line(ITEM_SHORT)?.soldQty), 5);
      checkEq("and 1 returned", n(line(ITEM_SHORT)?.returnedQty), 1);
      checkEq("the untouched item is expected whole", n(line(ITEM_OVER)?.expectedQty), 10);
      checkEq("invoiced sales are the invoice's total", n(expected?.invoicedSales), 570);
      checkEq("returns are the return's total", n(expected?.returnsValue), 114);

      const settled = await req("POST", `/field/van-trips/${TRIP}/settle`, {
        countedCash: "936",
        stockCounts: [
          { itemId: ITEM_SHORT, countedQty: "15" },
          { itemId: ITEM_OVER, countedQty: "11" },
        ],
      }, SETTLER);
      checkEq("the count is entered", settled.status, 200);
      const settlement = settled.body?.settlement;
      same("the trip waits for approval", settled.body?.status, "awaiting_approval");
      checkEq("the cash variance is the 20.00 missing", n(settlement?.cashVariance), -20);
      const countOf = (itemId: string) => (settlement?.stockCounts ?? []).find((l: any) => l.itemId === itemId);
      checkEq("one unit short", n(countOf(ITEM_SHORT)?.varianceQty), -1);
      checkEq("valued at the van's moving average", n(countOf(ITEM_SHORT)?.varianceValue), -COST_SHORT);
      checkEq("one unit over", n(countOf(ITEM_OVER)?.varianceQty), 1);
      checkEq("valued at the van's moving average", n(countOf(ITEM_OVER)?.varianceValue), COST_OVER);
      checkEq("the count posts nothing on its own", await gl(VAN_GL), 956);

      const selfApproval = await req("POST", `/field/van-trips/${TRIP}/approve`, {}, SETTLER);
      checkEq("the person who counted may not approve", selfApproval.status, 403);
      same("refused as self-approval", selfApproval.body?.error, "VAN_TRIP_SELF_APPROVAL");
      check("in Arabic and English", /[؀-ۿ]/.test(String(selfApproval.body?.message)) && typeof selfApproval.body?.messageEn === "string", JSON.stringify(selfApproval.body));
      checkEq("and nothing moved", await gl(VAN_GL), 956);

      const shortageBefore = await gl(SHORTAGE_ACCOUNT);
      const gainBefore = await gl(COUNT_GAIN_ACCOUNT);
      const cashShortBefore = await gl(CASH_SHORT_ACCOUNT);
      const tillBeforeHandover = await tillOf(MAIN_TILL);
      const approved = await req("POST", `/field/van-trips/${TRIP}/approve`, {}, SUPERVISOR);
      check("a second person approves", approved.status === 200 && approved.body?.held === false, `status ${approved.status} ${JSON.stringify(approved.body).slice(0, 300)}`);
      same("the trip is settled", approved.body?.trip?.status, "settled");
      const steps: any[] = approved.body?.trip?.settlement?.reconciliation?.steps ?? [];
      check("every step posted", steps.length === 5 && steps.every((s) => s.state === "posted"), JSON.stringify(steps));

      const vanShort = await stock(ITEM_SHORT, VAN_WH);
      const vanOver = await stock(ITEM_OVER, VAN_WH);
      checkEq("the van holds none of the short item", vanShort.onHand, 0);
      checkEq("and no value for it", vanShort.totalValue, 0);
      checkEq("the van holds none of the over item", vanOver.onHand, 0);
      checkEq("and no value for it", vanOver.totalValue, 0);
      checkEq("the van till is empty", await gl(VAN_GL), 0);
      checkEq("the main warehouse got the 15 counted back", (await stock(ITEM_SHORT, MAIN_WH)).onHand, mainShortBefore.onHand - 20 + 15);
      checkEq("and the 11 counted of the other item", (await stock(ITEM_OVER, MAIN_WH)).onHand, mainOverBefore.onHand - 10 + 11);
      checkEq("still at their own cost", (await stock(ITEM_OVER, MAIN_WH)).averageCost, COST_OVER);
      checkEq("the main till received the counted cash", (await tillOf(MAIN_TILL)) - tillBeforeHandover, 936);
      checkEq("the shortage is expensed to 5073 at WAC", (await gl(SHORTAGE_ACCOUNT)) - shortageBefore, COST_SHORT);
      checkEq("the overage is credited to 5074 at WAC", (await gl(COUNT_GAIN_ACCOUNT)) - gainBefore, -COST_OVER);
      checkEq("the cash shortfall is expensed to 5900", (await gl(CASH_SHORT_ACCOUNT)) - cashShortBefore, 20);

      const stepOf = (kind: string) => steps.find((s) => s.kind === kind);
      const shortageDoc = (await req("GET", `/inventory/stock-adjustments/${stepOf("shortage_adjustment")?.documentId}`)).body;
      check(
        "the shortage is a confirmed SHORTAGE adjustment OUT of the van",
        shortageDoc?.status === "confirmed" && shortageDoc?.lines?.[0]?.reason === "SHORTAGE" && shortageDoc?.lines?.[0]?.direction === "OUT" && shortageDoc?.lines?.[0]?.warehouseId === VAN_WH,
        JSON.stringify(shortageDoc).slice(0, 300),
      );
      const overageDoc = (await req("GET", `/inventory/stock-adjustments/${stepOf("overage_adjustment")?.documentId}`)).body;
      check(
        "the overage is a confirmed count correction IN to the van",
        overageDoc?.status === "confirmed" && overageDoc?.lines?.[0]?.reason === "PHYSICAL_COUNT" && overageDoc?.lines?.[0]?.direction === "IN" && overageDoc?.lines?.[0]?.warehouseId === VAN_WH,
        JSON.stringify(overageDoc).slice(0, 300),
      );
      const varianceVoucher = (await req("GET", `/vouchers/${stepOf("cash_variance")?.documentId}`)).body;
      check(
        "the cash variance is a confirmed expense voucher on the van till",
        varianceVoucher?.status === "confirmed" && varianceVoucher?.voucherType === "other_expense" && n(varianceVoucher?.amount) === 20 && varianceVoucher?.treasuryAccountId === VAN_TILL,
        JSON.stringify(varianceVoucher).slice(0, 300),
      );
      const handover = (await req("GET", `/vouchers/${stepOf("cash_return")?.documentId}`)).body;
      check(
        "the handover is a confirmed transfer of the counted 936.00 to the main till",
        handover?.status === "confirmed" && handover?.voucherType === "inter_treasury_transfer" && n(handover?.amount) === 936 && handover?.counterTreasuryAccountId === MAIN_TILL,
        JSON.stringify(handover).slice(0, 300),
      );

      const again = await req("POST", `/field/van-trips/${TRIP}/approve`, {}, SUPERVISOR);
      checkEq("approving a settled trip again is refused", again.status, 409);
    });
  },
};
