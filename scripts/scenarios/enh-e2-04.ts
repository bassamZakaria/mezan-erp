import type { ScenarioFragment } from "./fragments.js";

const BRANCH = "BR-MAIN";
const WH = "WH-SCN-EXP";
const ITEM = "SCN-EXP-ITEM";
const SUPPLIER = "SUPP-DEMO-1";
const CUSTOMER = "CUST-DEMO-1";
const EXPIRY_ACCOUNT = "5072";
const COGS = "5100";
const LOT_EXPIRED = "SCN-EXP-LOT-OLD";
const LOT_NEAR = "SCN-EXP-LOT-NEAR";
const LOT_FAR = "SCN-EXP-LOT-FAR";

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Batch and expiry (ENH-E2-04) on a warehouse of its own. Three lots at three
 * costs blend to a WAC of 25.00: 4 already expired at 30, 6 near expiry at 20,
 * 10 far off at 26. An expired lot at the FEFO head holds every issue of the
 * item (stock-ledger-service `refuseExpiredStock`), so the trail writes it
 * off first; the sale after it must draw the earliest in-date lot.
 */
export const scenario: ScenarioFragment = {
  smokePaths: ["/inventory/expiry/alerts", "/inventory/expiry/settings"],

  async run(ctx) {
    const { scenario: it, req, rows, n, check, checkEq, today } = ctx;
    const same = (label: string, actual: unknown, expected: unknown) => check(label, actual === expected, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
    const gl = async (code: string) => n((await req("GET", `/gl/accounts/${code}/ledger`)).body?.balance?.balance);
    const stock = async () => {
      const b = (await req("GET", `/inventory/balance?itemId=${ITEM}&warehouseId=${WH}`)).body;
      return { onHand: n(b?.onHand), averageCost: n(b?.averageCost), totalValue: n(b?.totalValue) };
    };
    const fefo = async (qty: string) => (await req("GET", `/inventory/fefo-preview?warehouseId=${WH}&itemId=${ITEM}&qty=${qty}`)).body;
    const expiredDay = addDays(today, -10);
    const nearDay = addDays(today, 30);
    const farDay = addDays(today, 200);
    const receivedDay = addDays(today, -40);

    const sale = (id: string) =>
      req("POST", "/sales-invoices", {
        id,
        date: today,
        dueDate: today,
        customerId: CUSTOMER,
        customerNameAr: "عميل الصلاحية",
        warehouseId: WH,
        branchId: BRANCH,
        currency: "EGP",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [{ lineId: `${id}-L1`, itemId: ITEM, itemNameAr: "دواء بتشغيلات", isStock: true, qty: "3", unitPrice: "60", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: COGS, inventoryAccountId: "1200" }],
      });

    await it("expiry · an expired lot holds the item's sales until it is written off at WAC, then FEFO sells the earliest in-date lot", async () => {
      checkEq("a pharmacy store is opened", (await req("POST", "/warehouses", { id: WH, code: "WH-SCN-EXP", name: "مخزن الصلاحية", nameEn: "Expiry store", branchId: BRANCH })).status, 201);
      const item = await req("POST", "/items", {
        id: ITEM, code: "SCN-EXP", nameAr: "دواء بتشغيلات", type: "stock", baseUnitCode: "PCS",
        trackInventory: true, trackBatches: true, trackExpiry: true,
        revenueAccountId: "4100", cogsAccountId: COGS, inventoryAccountId: "1200",
      });
      checkEq("a batch- and expiry-tracked item is created", item.status, 201);

      const receipt = await req("POST", "/purchases/receipts", {
        id: "SCN-EXP-GRN",
        date: receivedDay,
        supplierId: SUPPLIER,
        warehouseId: WH,
        lines: [
          { itemId: ITEM, qty: "4", unitCost: "30", batchNo: LOT_EXPIRED, expiryDate: expiredDay },
          { itemId: ITEM, qty: "6", unitCost: "20", batchNo: LOT_NEAR, expiryDate: nearDay },
          { itemId: ITEM, qty: "10", unitCost: "26", batchNo: LOT_FAR, expiryDate: farDay },
        ],
      });
      checkEq("three lots are received forty days ago, while the oldest was still in date", receipt.status, 201);
      const receiptConfirmed = await req("POST", "/purchases/receipts/SCN-EXP-GRN/confirm", {});
      check("and confirmed", receiptConfirmed.ok, JSON.stringify(receiptConfirmed.body).slice(0, 300));
      await req("POST", "/purchases/invoices", { id: "SCN-EXP-PINV", date: receivedDay, receiptId: "SCN-EXP-GRN", supplierId: SUPPLIER, branchId: BRANCH, warehouseId: WH, currency: "EGP" });
      check("and invoiced by the supplier", (await req("POST", "/purchases/invoices/SCN-EXP-PINV/confirm", {})).ok);
      const received = await stock();
      checkEq("20 units are on hand", received.onHand, 20);
      checkEq("at a blended WAC of (4×30 + 6×20 + 10×26) / 20", received.averageCost, 25);

      const alertsOf = async () => {
        const body = (await req("GET", "/inventory/expiry/alerts")).body;
        return {
          due: (body?.due ?? []).filter((r: any) => r.itemId === ITEM),
          log: (body?.log ?? []).filter((l: any) => l.itemId === ITEM),
          nearExpiryDays: n(body?.nearExpiryDays),
        };
      };
      check("the expiry scan runs on demand", (await req("POST", "/inventory/expiry/scan", {})).ok);
      const alerts = await alertsOf();
      const dueOf = (batchNo: string) => alerts.due.find((r: any) => r.batchNo === batchNo);
      same("the old lot is due as expired", dueOf(LOT_EXPIRED)?.status, "expired");
      checkEq("for its 4 units", n(dueOf(LOT_EXPIRED)?.qty), 4);
      same("the 30-day lot is due as near expiry", dueOf(LOT_NEAR)?.status, "near_expiry");
      check("the 200-day lot is outside the warning window and not due", 200 > alerts.nearExpiryDays && !dueOf(LOT_FAR), JSON.stringify(alerts.due));
      check(
        "and the scan logged exactly one alert per due lot",
        alerts.log.length === 2 && alerts.log.some((l: any) => l.batchNo === LOT_EXPIRED && l.kind === "expired") && alerts.log.some((l: any) => l.batchNo === LOT_NEAR && l.kind === "near_expiry"),
        JSON.stringify(alerts.log),
      );

      const blocked = await fefo("3");
      same("the FEFO preview says the next issue is blocked by expired stock", blocked?.blockedByExpired, true);
      checkEq("naming the 4 expired units", n(blocked?.expiredQty), 4);
      same("the head slice is the expired lot", blocked?.slices?.[0]?.batchNo, LOT_EXPIRED);
      same("then the near lot", blocked?.slices?.[1]?.batchNo, LOT_NEAR);
      same("then the far lot", blocked?.slices?.[2]?.batchNo, LOT_FAR);

      checkEq("a sale is drafted", (await sale("SCN-EXP-INV")).status, 201);
      const refused = await req("POST", "/sales-invoices/SCN-EXP-INV/confirm", {});
      checkEq("its confirm is refused while the expired lot heads the queue", refused.status, 422);
      same("as expired stock", refused.body?.error, "EXPIRED_STOCK");
      checkEq("and nothing left the shelf", (await stock()).onHand, 20);

      const proposal = (await req("GET", `/inventory/expiry/write-off-proposal?warehouseId=${WH}`)).body;
      const proposed = (proposal?.lines ?? []).find((l: any) => l.itemId === ITEM);
      checkEq("the write-off proposal is the 4 expired units", n(proposed?.qty), 4);
      checkEq("valued at WAC, as the adjustment will post them", n(proposed?.value), 100);
      checkEq("not at the lot's own receipt cost", n(proposed?.layerValue), 120);

      const expiryBefore = await gl(EXPIRY_ACCOUNT);
      const inventoryBefore = await gl("1200");
      const writeOff = await req("POST", "/inventory/expiry/write-off", { warehouseId: WH, itemIds: [ITEM] });
      check("the write-off is drafted", writeOff.status === 201 && writeOff.body?.status === "draft", `status ${writeOff.status} ${JSON.stringify(writeOff.body).slice(0, 200)}`);
      checkEq("drafting moves nothing", (await stock()).onHand, 20);
      const confirmed = await req("POST", `/inventory/stock-adjustments/${writeOff.body?.adjustmentId}/confirm`, {});
      check("and confirmed", confirmed.ok, JSON.stringify(confirmed.body).slice(0, 200));
      const doc = (await req("GET", `/inventory/stock-adjustments/${writeOff.body?.adjustmentId}`)).body;
      check("as an EXPIRY adjustment OUT", doc?.lines?.[0]?.reason === "EXPIRY" && doc?.lines?.[0]?.direction === "OUT", JSON.stringify(doc?.lines));
      checkEq("4 units leave", (await stock()).onHand, 16);
      checkEq("the write-off is expensed to 5072 at WAC", (await gl(EXPIRY_ACCOUNT)) - expiryBefore, 100);
      checkEq("and comes off 1200 by the same amount", inventoryBefore - (await gl("1200")), 100);
      checkEq("the moving average is unchanged by an issue", (await stock()).averageCost, 25);

      const clear = await fefo("3");
      same("the preview is no longer blocked", clear?.blockedByExpired, false);
      checkEq("no expired stock remains", n(clear?.expiredQty), 0);
      same("the head is now the earliest in-date lot", clear?.slices?.[0]?.batchNo, LOT_NEAR);
      checkEq("which covers all 3", n(clear?.slices?.[0]?.take), 3);

      const cogsBefore = await gl(COGS);
      const sold = await req("POST", "/sales-invoices/SCN-EXP-INV/confirm", {});
      checkEq("the same sale now confirms", sold.status, 200);
      checkEq("3 units leave", (await stock()).onHand, 13);
      checkEq("COGS charges 3 × WAC", (await gl(COGS)) - cogsBefore, 75);
      const trail = rows((await req("GET", "/inventory/expiry/batch-trail?sourceDocId=SCN-EXP-INV")).body);
      check(
        "and the batch trail shows they came from the near lot",
        trail.length === 1 && trail[0]?.batchNo === LOT_NEAR && n(trail[0]?.qty) === 3 && trail[0]?.expiryDate === nearDay,
        JSON.stringify(trail),
      );
      const after = await fefo("13");
      checkEq("the near lot keeps 3", n((after?.slices ?? []).find((s: any) => s.batchNo === LOT_NEAR)?.available), 3);
      checkEq("the far lot is untouched", n((after?.slices ?? []).find((s: any) => s.batchNo === LOT_FAR)?.available), 10);
      check("and the expired lot is gone", !(after?.slices ?? []).some((s: any) => s.batchNo === LOT_EXPIRED), JSON.stringify(after?.slices));
      check("a later scan finds nothing new to alert", (await req("POST", "/inventory/expiry/scan", {})).ok);
      checkEq("the same lots are never alerted twice", (await alertsOf()).log.length, 2);
    });

    await it("expiry · in-date stock cannot be written off as expired", async () => {
      const before = await stock();
      const expiryBefore = await gl(EXPIRY_ACCOUNT);
      const nothing = await req("POST", "/inventory/expiry/write-off", { warehouseId: WH, itemIds: [ITEM] });
      checkEq("the expiry write-off finds nothing to write off", nothing.status, 422);
      same("and says so", nothing.body?.error, "NO_EXPIRED_STOCK");

      const forced = await req("POST", "/inventory/adjustments", {
        adjustmentId: "SCN-EXP-FORCED",
        occurredAt: `${today}T10:00:00.000Z`,
        warehouseId: WH,
        reason: "EXPIRY",
        lines: [{ itemId: ITEM, direction: "OUT", qty: "1" }],
      });
      checkEq("a hand-made EXPIRY adjustment against in-date stock is refused", forced.status, 422);
      same("as more than is actually expired", forced.body?.error, "EXPIRY_WRITE_OFF_EXCEEDS_EXPIRED");
      check("in Arabic and English", /[؀-ۿ]/.test(String(forced.body?.message)) && typeof forced.body?.messageEn === "string", JSON.stringify(forced.body));
      checkEq("no stock moved", (await stock()).onHand, before.onHand);
      checkEq("and nothing was expensed", (await gl(EXPIRY_ACCOUNT)) - expiryBefore, 0);
    });
  },
};
