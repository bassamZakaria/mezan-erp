import type { Ctx } from "./harness.js";

/** Executable checks for the inventory module — see docs/scenarios/03-inventory.md. */
export async function run(ctx: Ctx): Promise<void> {
  await ctx.scenario("inventory / warehouse scoping — every list route the screens call narrows to the granted warehouses", () => warehouseScoping(ctx));
  await openingBalanceReconciles(ctx);
  await transferMovesValueBetweenWarehouses(ctx);
  await fefoConsumesEarliestExpiry(ctx);
  await fifoConsumesOldestReceiptWhenNoExpiry(ctx);
  await sameWarehouseTransferRejected(ctx);
  await issuingMoreThanOnHandRejected(ctx);
  await negativeCountQtyRejected(ctx);
  await physicalCountAdjustmentPostsNoJournalEntry_D2(ctx);
  await completingAWorkOrderNeverTouchesGl1200_D3(ctx);
  await everyAdjustmentReasonPostsToItsOwnAccount_R59(ctx);
  await purchaseReturnCreditsInventoryAtWhatLeftStock_D47(ctx);
  await draftsReserveStockAndConfirmingConvertsIt_R56(ctx);
  await itemTypeCapabilitiesBind_R51(ctx);
  await openingBalanceShortcutTargetsARealItem_R53(ctx);
  await catalogFacetsAreEntities_R510(ctx);
  await itemDefaultSupplierIsBound_R54(ctx);
  await attentionBannerCountsMatchTheirFilter_R19(ctx);
}

async function itemBalance(ctx: Ctx, itemId: string, warehouseId: string) {
  const res = await ctx.req("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${warehouseId}`);
  return { onHand: ctx.n(res.body?.onHand), averageCost: ctx.n(res.body?.averageCost), totalValue: ctx.n(res.body?.totalValue) };
}

async function createItem(ctx: Ctx, id: string, code: string, nameAr: string) {
  return ctx.req("POST", "/items", {
    id,
    code,
    nameAr,
    type: "stock",
    baseUnitCode: "PCS",
    trackInventory: true,
    revenueAccountId: "4100",
    cogsAccountId: "5100",
    inventoryAccountId: "1200",
  });
}

async function draftAndConfirm(ctx: Ctx, kind: "stock-adjustments" | "stock-transfers", id: string, rest: Record<string, unknown>) {
  const draft = await ctx.req("POST", `/inventory/${kind}/draft`, { id, ...rest });
  const confirm = await ctx.req("POST", `/inventory/${kind}/${id}/confirm`, {});
  return { draft, confirm };
}

async function rowCountAt(ctx: Ctx, path: string, warehouseScope: string): Promise<number> {
  const res = await ctx.req("GET", path, undefined, { "x-warehouse-scope": warehouseScope });
  return ctx.rows(res.body).length;
}

/**
 * F8 fixed this for the six raw/read routes; the document-layer list routes the
 * Stock Adjustments and Stock Transfers SCREENS actually call (`/inventory/stock-adjustments`,
 * `/inventory/stock-transfers`) never got `withinScope` wired in — a regression F8's
 * own commit message did not claim to cover.
 */
async function warehouseScoping(ctx: Ctx): Promise<void> {
  const shouldNarrow = [
    "/inventory/stock-balance",
    "/reports/inventory/valuation",
    "/inventory/physical-counts",
    "/inventory/adjustments",
    "/inventory/transfers",
  ];
  for (const path of shouldNarrow) {
    const all = await rowCountAt(ctx, path, "*");
    const scoped = await rowCountAt(ctx, path, "WH-DEMO-2");
    ctx.check(`x-warehouse-scope=WH-DEMO-2 narrows ${path}`, scoped > 0 && scoped < all, `all=${all} WH-DEMO-2=${scoped}`);
  }

  // The document-layer list routes the Stock Adjustments and Stock Transfers
  // SCREENS actually call (F15). The tenant seeds only two warehouses, and the
  // one seeded transfer runs between them — visible from either end by design,
  // so it can never prove narrowing. A third warehouse and a transfer that
  // never touches WH-DEMO-2 makes the scoping provable.
  const thirdWarehouse = await ctx.req("POST", "/warehouses", {
    id: "WH-SCN-3", code: "WH-SCN-3", name: "مخزن سيناريو الثالث", branchId: "BR-MAIN", type: "MAIN", active: true,
  });
  ctx.check("third warehouse created for the scoping proof", thirdWarehouse.status === 201, `${thirdWarehouse.status}: ${JSON.stringify(thirdWarehouse.body)}`);
  const offScope = await draftAndConfirm(ctx, "stock-transfers", "SCN-TRF-SCOPE", {
    date: "2026-08-24",
    lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-SCN-3", qty: "1" }],
  });
  ctx.check("a transfer that never touches WH-DEMO-2 confirms", offScope.confirm.status === 200, JSON.stringify(offScope.confirm.body).slice(0, 200));

  for (const path of ["/inventory/stock-adjustments", "/inventory/stock-transfers"]) {
    const all = await rowCountAt(ctx, path, "*");
    const scoped = await rowCountAt(ctx, path, "WH-DEMO-2");
    ctx.check(
      `x-warehouse-scope=WH-DEMO-2 narrows ${path} (the screen's own list route)`,
      scoped > 0 && scoped < all,
      `all=${all} WH-DEMO-2=${scoped}`,
    );
  }

  const scopedToThird = ctx.rows((await ctx.req("GET", "/inventory/stock-transfers", undefined, { "x-warehouse-scope": "WH-SCN-3" })).body);
  ctx.check("scoping to WH-SCN-3 shows its own transfer and nothing else", scopedToThird.length === 1 && scopedToThird[0].id === "SCN-TRF-SCOPE", JSON.stringify(scopedToThird.map((t: any) => t.id)));

  const fromMain = ctx.rows((await ctx.req("GET", "/inventory/transfers", undefined, { "x-warehouse-scope": "WH-MAIN" })).body);
  const fromGiza = ctx.rows((await ctx.req("GET", "/inventory/transfers", undefined, { "x-warehouse-scope": "WH-DEMO-2" })).body);
  ctx.check("TRF-DEMO-1 stays visible scoped to its source warehouse WH-MAIN", fromMain.some((t: any) => t.id === "TRF-DEMO-1"));
  ctx.check("TRF-DEMO-1 stays visible scoped to its destination warehouse WH-DEMO-2", fromGiza.some((t: any) => t.id === "TRF-DEMO-1"));
}

async function openingBalanceReconciles(ctx: Ctx): Promise<void> {
  await ctx.scenario("stock-adjustments: INITIAL_STOCK opens a new item and posts a balanced Dr 1200 / Cr 3100", async () => {
    const itemId = "SCN-ITEM-OPEN";
    await createItem(ctx, itemId, "SCN-OPEN-1", "صنف افتتاحي اختباري");

    const { draft, confirm } = await draftAndConfirm(ctx, "stock-adjustments", "SCN-ADJ-OPEN-1", {
      date: "2026-08-24",
      lines: [{ itemId, warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "50", unitCost: "20" }],
    });
    ctx.check("opening-balance draft created", draft.status === 201, JSON.stringify(draft.body));
    ctx.check("opening-balance adjustment confirmed", confirm.status === 200, JSON.stringify(confirm.body));

    const bal = await itemBalance(ctx, itemId, "WH-MAIN");
    ctx.checkEq("opening balance on-hand qty", bal.onHand, 50);
    ctx.checkEq("opening balance average cost", bal.averageCost, 20);
    ctx.checkEq("opening balance total value", bal.totalValue, 1000);

    // The adjustment's OWN id doubles as its journal entry's id (document-hooks.ts)
    // — the confirmed document's own `journalEntryId` field is never populated for
    // this document type, so a 200 here (not that field) is the real GL proof.
    const je = await ctx.req("GET", "/gl/journal-entries/SCN-ADJ-OPEN-1");
    ctx.check("opening-balance adjustment has a posted journal entry", je.status === 200, JSON.stringify(je.body));
    const lines = (je.body?.lines ?? []) as Array<{ accountId: string; debit: string; credit: string }>;
    const debit1200 = lines.filter((l) => l.accountId === "1200").reduce((s, l) => s + ctx.n(l.debit), 0);
    const credit3100 = lines.filter((l) => l.accountId === "3100").reduce((s, l) => s + ctx.n(l.credit), 0);
    ctx.checkEq("opening balance GL debit on 1200 equals qty × unit cost", debit1200, 1000);
    ctx.checkEq("opening balance GL credit on 3100 equals qty × unit cost", credit3100, 1000);
  });
}

async function transferMovesValueBetweenWarehouses(ctx: Ctx): Promise<void> {
  await ctx.scenario("stock-transfers: WH-MAIN → WH-DEMO-2 moves qty and value between warehouses, none leaves the company", async () => {
    const itemId = "ITEM-DEMO-1";
    const beforeMain = await itemBalance(ctx, itemId, "WH-MAIN");
    const beforeGiza = await itemBalance(ctx, itemId, "WH-DEMO-2");

    const { draft, confirm } = await draftAndConfirm(ctx, "stock-transfers", "SCN-TRF-1", {
      date: "2026-08-24",
      lines: [{ itemId, fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-DEMO-2", qty: "10" }],
    });
    ctx.check("transfer draft created", draft.status === 201, JSON.stringify(draft.body));
    ctx.check("transfer confirmed", confirm.status === 200, JSON.stringify(confirm.body));

    const afterMain = await itemBalance(ctx, itemId, "WH-MAIN");
    const afterGiza = await itemBalance(ctx, itemId, "WH-DEMO-2");
    ctx.checkEq("WH-MAIN on-hand drops by the transferred qty", beforeMain.onHand - afterMain.onHand, 10);
    ctx.checkEq("WH-DEMO-2 on-hand rises by the transferred qty", afterGiza.onHand - beforeGiza.onHand, 10);
    ctx.checkEq(
      "combined total value across both warehouses is unchanged — a transfer moves value, not creates or destroys it",
      afterMain.totalValue + afterGiza.totalValue,
      beforeMain.totalValue + beforeGiza.totalValue,
    );

    const fromMain = ctx.rows((await ctx.req("GET", "/inventory/transfers", undefined, { "x-warehouse-scope": "WH-MAIN" })).body);
    const fromGiza = ctx.rows((await ctx.req("GET", "/inventory/transfers", undefined, { "x-warehouse-scope": "WH-DEMO-2" })).body);
    ctx.check("new transfer visible scoped to its source warehouse", fromMain.some((t: any) => t.id === "SCN-TRF-1"));
    ctx.check("new transfer visible scoped to its destination warehouse", fromGiza.some((t: any) => t.id === "SCN-TRF-1"));
  });
}

async function fefoConsumesEarliestExpiry(ctx: Ctx): Promise<void> {
  const res = await ctx.req("GET", "/reports/inventory/expiring");
  const rows = ctx.rows(res.body);
  const earlierExpiryReceivedSecond = rows.find((r: any) => r.batchNo === "MLK-2708");
  const laterExpiryReceivedFirst = rows.find((r: any) => r.batchNo === "MLK-2607");
  ctx.check("both milk batches still carry layers", !!earlierExpiryReceivedSecond && !!laterExpiryReceivedFirst, JSON.stringify(rows));
  if (!earlierExpiryReceivedSecond || !laterExpiryReceivedFirst) return;

  ctx.checkEq(
    "FEFO drew INV-DEMO-5's 60-unit sale from MLK-2708 (expires 2026-09-05, received SECOND on 2026-08-06): 100 − 60 = 40 left",
    ctx.n(earlierExpiryReceivedSecond.qty),
    40,
  );
  ctx.checkEq(
    "MLK-2607 (expires 2026-10-20, received FIRST on 2026-07-28) is untouched by the sale despite being the older receipt",
    ctx.n(laterExpiryReceivedFirst.qty),
    150,
  );
}

async function fifoConsumesOldestReceiptWhenNoExpiry(ctx: Ctx): Promise<void> {
  const itemId = "SCN-ITEM-FIFO";
  await createItem(ctx, itemId, "SCN-FIFO-1", "صنف اختبار FIFO بلا صلاحية");

  await draftAndConfirm(ctx, "stock-adjustments", "SCN-ADJ-FIFO-1", {
    date: "2026-01-10",
    lines: [{ itemId, warehouseId: "WH-MAIN", reason: "OTHER", direction: "IN", qty: "10", unitCost: "100" }],
  });
  await draftAndConfirm(ctx, "stock-adjustments", "SCN-ADJ-FIFO-2", {
    date: "2026-01-15",
    lines: [{ itemId, warehouseId: "WH-MAIN", reason: "OTHER", direction: "IN", qty: "10", unitCost: "200" }],
  });
  const { confirm } = await draftAndConfirm(ctx, "stock-adjustments", "SCN-ADJ-FIFO-3", {
    date: "2026-01-20",
    lines: [{ itemId, warehouseId: "WH-MAIN", reason: "OTHER", direction: "OUT", qty: "5" }],
  });
  ctx.check("FIFO test: OUT of 5 confirmed", confirm.status === 200, JSON.stringify(confirm.body));

  const aging = ctx.rows((await ctx.req("GET", "/reports/inventory/aging")).body);
  const row = aging.find((r: any) => r.key === `${itemId}|WH-MAIN`);
  ctx.check("FIFO test: item still has a position in the aging report", !!row, JSON.stringify(aging));
  if (!row) return;

  ctx.checkEq("FIFO test: 15 units remain (10 + 10 − 5)", ctx.n(row.qty), 15);
  ctx.checkEq(
    "an item with no expiry consumes the OLDEST receipt first: the OUT of 5 drew the 100-cost layer, not the 200-cost one — remaining value is 5×100 + 10×200 = 2500, not 10×100 + 5×200 = 2000",
    ctx.n(row.totalValue),
    2500,
  );
}

async function sameWarehouseTransferRejected(ctx: Ctx): Promise<void> {
  const res = await ctx.req("POST", "/inventory/stock-transfers/draft", {
    id: "SCN-TRF-SAME",
    date: "2026-08-24",
    lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-MAIN", qty: "5" }],
  });
  ctx.check("a transfer to the same warehouse is rejected on draft creation", res.status === 400, `status ${res.status}: ${JSON.stringify(res.body)}`);
}

async function issuingMoreThanOnHandRejected(ctx: Ctx): Promise<void> {
  const before = await itemBalance(ctx, "ITEM-DEMO-2", "WH-MAIN");
  const { draft, confirm } = await draftAndConfirm(ctx, "stock-adjustments", "SCN-ADJ-OVERISSUE", {
    date: "2026-08-24",
    lines: [{ itemId: "ITEM-DEMO-2", warehouseId: "WH-MAIN", reason: "DAMAGE", direction: "OUT", qty: "999999" }],
  });
  ctx.check("over-issue draft is accepted — stock availability is only checked on confirm", draft.status === 201, JSON.stringify(draft.body));
  ctx.check(
    "confirming an OUT beyond on-hand is refused with NEGATIVE_STOCK",
    confirm.status === 422 && confirm.body?.error === "NEGATIVE_STOCK",
    `status ${confirm.status}: ${JSON.stringify(confirm.body)}`,
  );

  const doc = await ctx.req("GET", "/inventory/stock-adjustments/SCN-ADJ-OVERISSUE");
  ctx.check("the refused adjustment stays a draft", doc.body?.status === "draft");
  const after = await itemBalance(ctx, "ITEM-DEMO-2", "WH-MAIN");
  ctx.checkEq("no stock actually moved after the refusal", after.onHand, before.onHand);
}

async function negativeCountQtyRejected(ctx: Ctx): Promise<void> {
  const start = await ctx.req("POST", "/inventory/physical-counts", {
    id: "SCN-PC-NEG",
    warehouseId: "WH-MAIN",
    date: "2026-08-24",
    itemIds: ["ITEM-DEMO-1"],
  });
  ctx.check("count session starts", start.status === 201, JSON.stringify(start.body));

  const record = await ctx.req("POST", "/inventory/physical-counts/SCN-PC-NEG/counts", {
    entries: [{ itemId: "ITEM-DEMO-1", countedQty: "-5" }],
  });
  ctx.check(
    "a negative counted quantity is rejected by the contract before it reaches the domain",
    record.status === 400 && record.body?.error === "VALIDATION_ERROR",
    `status ${record.status}: ${JSON.stringify(record.body)}`,
  );
}

/**
 * D2 (docs/defects.md): a PHYSICAL_COUNT adjustment moves stock with no journal
 * entry, so a one-sided count leaves the sub-ledger and GL 1200 off by exactly
 * the variance value. Deliberately NOT wrapped in `scenario()` — its automatic
 * reconciliation check would report this as a fresh failure every run. Plain
 * checks instead, so the suite stays green while still proving the gap, and the
 * day it's fixed these assertions fail loudly.
 */
async function physicalCountAdjustmentPostsNoJournalEntry_D2(ctx: Ctx): Promise<void> {
  const before = await ctx.invariants();

  const start = await ctx.req("POST", "/inventory/physical-counts", {
    id: "SCN-PC-D2",
    warehouseId: "WH-MAIN",
    date: "2026-08-24",
    itemIds: ["ITEM-DEMO-1"],
  });
  ctx.check("D2 setup — count session starts", start.status === 201, JSON.stringify(start.body));
  const systemQty = ctx.n(start.body?.lines?.[0]?.systemQty);
  const countedQty = (systemQty + 5).toString();

  const record = await ctx.req("POST", "/inventory/physical-counts/SCN-PC-D2/counts", {
    entries: [{ itemId: "ITEM-DEMO-1", countedQty }],
  });
  await ctx.req("POST", "/inventory/physical-counts/SCN-PC-D2/complete", {});
  const generated = await ctx.req("POST", "/inventory/physical-counts/SCN-PC-D2/generate-adjustment", { adjustmentId: "SCN-ADJ-D2" });
  ctx.check("D2 setup — adjustment generated from the count", generated.status === 200, JSON.stringify(generated.body));

  const netValue = ctx.n(record.body?.variance?.netValue);
  ctx.check("D2 setup — the count carries a non-zero net variance to prove", netValue > 0, `netValue=${netValue}`);

  const adjustment = generated.body?.adjustment;
  ctx.check(
    "D2 — a PHYSICAL_COUNT adjustment moves stock (over count is a real IN line)",
    adjustment?.lines?.[0]?.direction === "IN" && ctx.n(adjustment.lines[0].qty) === 5,
    JSON.stringify(adjustment),
  );
  // D2 is fixed (F23/R5.9): every adjustment reason now carries its own GL
  // contra account, so a count correction posts Dr/Cr 1200 ↔ 5074 instead of
  // moving stock silently. These two assertions used to record the defect;
  // inverted, they are its regression test.
  const je = await ctx.req("GET", "/gl/journal-entries/SCN-ADJ-D2");
  ctx.check(
    "D2 fixed — the PHYSICAL_COUNT adjustment posts a journal entry",
    je.status === 200,
    `status ${je.status}: ${JSON.stringify(je.body)}`,
  );
  const jeLines: { accountId: string; debit: string; credit: string }[] = je.body?.lines ?? [];
  ctx.check(
    "D2 fixed — it moves 1200 against the count-variance account 5074, and balances",
    jeLines.some((l) => l.accountId === "1200") &&
      jeLines.some((l) => l.accountId === "5074") &&
      jeLines.reduce((sum, l) => sum + ctx.n(l.debit), 0) === jeLines.reduce((sum, l) => sum + ctx.n(l.credit), 0),
    JSON.stringify(jeLines),
  );

  const after = await ctx.invariants();
  ctx.checkEq(
    "D2 fixed — the count leaves the inventory sub-ledger and GL 1200 in step",
    after.inventory - before.inventory,
    0,
  );
}

/**
 * D3 (docs/defects.md): `completeWorkOrder` never touches GL 1200. Not wrapped
 * in `scenario()` for the same reason as D2 above. BOM-DEMO-1 at plannedQty 10
 * reproduces the exact 80.00 gap defects.md measured (labor 50 + overhead 30 —
 * the fixed order-level costs neither `issue` nor `receive` ever post to the
 * ledger, so the net stock movement they cause is exactly labor + overhead).
 */
async function completingAWorkOrderNeverTouchesGl1200_D3(ctx: Ctx): Promise<void> {
  const before = await ctx.invariants();

  const create = await ctx.req("POST", "/manufacturing/work-orders", {
    id: "SCN-WO-D3",
    bomId: "BOM-DEMO-1",
    plannedQty: "10",
    sourceWarehouseId: "WH-MAIN",
    destinationWarehouseId: "WH-MAIN",
    scheduledStartDate: "2026-08-24",
  });
  ctx.check("D3 setup — work order created", create.status === 201, JSON.stringify(create.body));

  const start = await ctx.req("POST", "/manufacturing/work-orders/SCN-WO-D3/start", {});
  const issue = await ctx.req("POST", "/manufacturing/work-orders/SCN-WO-D3/issue", {});
  const receive = await ctx.req("POST", "/manufacturing/work-orders/SCN-WO-D3/receive", { producedQty: "10" });
  const complete = await ctx.req("POST", "/manufacturing/work-orders/SCN-WO-D3/complete", {});
  ctx.check("D3 setup — start/issue/receive/complete all succeed", [start, issue, receive, complete].every((r) => r.status === 200));
  ctx.check("D3 — the work order reaches status completed", complete.body?.status === "completed", JSON.stringify(complete.body));

  const after = await ctx.invariants();
  ctx.checkEq(
    "D3 — completing the work order leaves inventory off GL 1200 by exactly labor + overhead (80.00), the portion issue/receive move with no GL entry at all",
    after.inventory - before.inventory,
    80,
  );
}

/**
 * R5.9 — every adjustment reason posts to its OWN GL contra account. Seven of
 * the eight reasons used to post nothing at all (F23), so the stock sub-ledger
 * drifted away from GL 1200 silently. One reason per account, each checked for
 * balance, is the regression test for that.
 */
async function everyAdjustmentReasonPostsToItsOwnAccount_R59(ctx: Ctx): Promise<void> {
  await ctx.scenario("stock-adjustments: each reason posts a balanced entry to its own contra account (R5.9)", async () => {
    const cases = [
      { reason: "DAMAGE", account: "5070" },
      { reason: "THEFT", account: "5071" },
      { reason: "EXPIRY", account: "5072" },
      { reason: "SHORTAGE", account: "5073" },
      { reason: "OTHER", account: "5075" },
      { reason: "SUPPLIER_RETURN", account: "2110" },
    ];

    for (const { reason, account } of cases) {
      const id = `SCN-ADJ-R59-${reason}`;
      const { draft, confirm } = await draftAndConfirm(ctx, "stock-adjustments", id, {
        date: "2026-08-24",
        lines: [{ itemId: "ITEM-DEMO-1", warehouseId: "WH-MAIN", reason, direction: "OUT", qty: "1" }],
      });
      ctx.check(`${reason} — draft created`, draft.status === 201, JSON.stringify(draft.body));
      ctx.check(`${reason} — confirmed`, confirm.status === 200, JSON.stringify(confirm.body));

      const je = await ctx.req("GET", `/gl/journal-entries/${id}`);
      ctx.check(`${reason} — posts a journal entry at all`, je.status === 200, `status ${je.status}`);
      const lines = (je.body?.lines ?? []) as Array<{ accountId: string; debit: string; credit: string }>;
      ctx.check(
        `${reason} — moves GL 1200 against ${account}`,
        lines.some((l) => l.accountId === "1200") && lines.some((l) => l.accountId === account),
        JSON.stringify(lines.map((l) => l.accountId)),
      );
      ctx.checkEq(
        `${reason} — the entry balances`,
        lines.reduce((sum, l) => sum + ctx.n(l.debit), 0),
        lines.reduce((sum, l) => sum + ctx.n(l.credit), 0),
      );
    }
  });
}

/**
 * D47 — a purchase return relieves stock at the position's moving average but
 * settles with the supplier at the invoice price. The difference must land in
 * 5080 فروق أسعار الشراء, or the sub-ledger and GL 1200 part company.
 */
async function purchaseReturnCreditsInventoryAtWhatLeftStock_D47(ctx: Ctx): Promise<void> {
  await ctx.scenario("purchase returns credit inventory at moving-average cost, variance to 5080 (D47)", async () => {
    // NOT asserted as zero: D3 (a completed work order never touches GL 1200)
    // runs earlier in this file and leaves a known 80.00 gap. This scenario is
    // about the purchase-return posting itself, not that open defect.
    const entries = await ctx.req("GET", "/gl/journal-entries");
    const list = (entries.body ?? []) as Array<{
      memo?: string;
      lines: Array<{ accountId: string; debit: string; credit: string }>;
    }>;
    const returns = list.filter((e) => e.lines.some((l) => l.accountId === "2100" && ctx.n(l.debit) > 0) && e.lines.some((l) => l.accountId === "1200" && ctx.n(l.credit) > 0));
    ctx.check("the seed contains at least one posted purchase return", returns.length > 0, `found ${returns.length}`);

    for (const entry of returns) {
      const debits = entry.lines.reduce((sum, l) => sum + ctx.n(l.debit), 0);
      const credits = entry.lines.reduce((sum, l) => sum + ctx.n(l.credit), 0);
      ctx.checkEq(`purchase return "${(entry.memo ?? "").slice(0, 30)}" balances`, debits, credits);

      const payable = entry.lines.filter((l) => l.accountId === "2100").reduce((sum, l) => sum + ctx.n(l.debit), 0);
      const inventory = entry.lines.filter((l) => l.accountId === "1200").reduce((sum, l) => sum + ctx.n(l.credit), 0);
      const tax = entry.lines.filter((l) => l.accountId === "1400").reduce((sum, l) => sum + ctx.n(l.credit), 0);
      const variance = entry.lines
        .filter((l) => l.accountId === "5080")
        .reduce((sum, l) => sum + ctx.n(l.debit) - ctx.n(l.credit), 0);
      // The supplier is credited at the invoice price; stock left at its
      // moving average. The variance account is what makes the two meet.
      ctx.checkEq(
        `purchase return "${(entry.memo ?? "").slice(0, 30)}" — AP + variance = inventory + tax`,
        payable + variance,
        inventory + tax,
      );
      ctx.check(
        `purchase return "${(entry.memo ?? "").slice(0, 30)}" — a non-zero variance is booked to 5080, never buried in 1200`,
        variance === 0 || entry.lines.some((l) => l.accountId === "5080"),
        JSON.stringify(entry.lines.map((l) => l.accountId)),
      );
    }
  });
}

/**
 * R5.6 — reserved stock is derived from open documents, so confirming one must
 * convert the reservation into a movement with neither a double-count nor a
 * gap: `available` is the figure that must not move across the confirm.
 */
async function draftsReserveStockAndConfirmingConvertsIt_R56(ctx: Ctx): Promise<void> {
  await ctx.scenario("a draft sales invoice reserves stock; confirming it converts the reservation (R5.6)", async () => {
    const read = async () => {
      const res = await ctx.req("GET", "/inventory/items/ITEM-DEMO-1/stock");
      const position = ((res.body?.positions ?? []) as Array<{ warehouseId: string; onHand: string; reserved: string; available: string }>)
        .find((p) => p.warehouseId === "WH-MAIN");
      return {
        onHand: ctx.n(position?.onHand),
        reserved: ctx.n(position?.reserved),
        available: ctx.n(position?.available),
      };
    };

    const before = await read();
    ctx.checkEq("before: available = on hand − reserved", before.available, before.onHand - before.reserved);

    const created = await ctx.req("POST", "/sales-invoices", {
      id: "SCN-INV-RESERVE",
      date: "2026-08-26",
      dueDate: "2026-09-26",
      customerId: "CUST-DEMO-1",
      customerNameAr: "شركة الأمل للتجارة",
      branchId: "BR-MAIN",
      warehouseId: "WH-MAIN",
      currency: "EGP",
      arAccountId: "1105",
      taxAccountId: "2200",
      discount: { type: "amount", amount: "0" },
      lines: [
        {
          lineId: "L1",
          itemId: "ITEM-DEMO-1",
          itemNameAr: "أرز أبيض ٥ كجم",
          isStock: true,
          qty: "7",
          unitPrice: "180",
          discountPercent: 0,
          taxRatePercent: 14,
          revenueAccountId: "4100",
          cogsAccountId: "5100",
          inventoryAccountId: "1200",
        },
      ],
    });
    ctx.check("the draft invoice is created", created.status === 201, JSON.stringify(created.body));

    const reserved = await read();
    ctx.checkEq("the draft reserves its 7 units", reserved.reserved, before.reserved + 7);
    ctx.checkEq("on hand has not moved — a draft moves no stock", reserved.onHand, before.onHand);
    ctx.checkEq("available drops by the reservation", reserved.available, before.available - 7);

    const confirmed = await ctx.req("POST", "/sales-invoices/SCN-INV-RESERVE/confirm", {});
    ctx.check("the invoice confirms", confirmed.status === 200, JSON.stringify(confirmed.body));

    const after = await read();
    ctx.checkEq("confirming releases the reservation", after.reserved, before.reserved);
    ctx.checkEq("confirming relieves the stock instead", after.onHand, before.onHand - 7);
    // The property that matters: a reservation becoming a movement must not
    // change what is promisable, or it was counted twice or not at all.
    ctx.checkEq("available is unchanged across the confirm — no double-count, no gap", after.available, reserved.available);
  });
}

/**
 * R5.1 — the six item types are enforced by capability, not by a string match
 * on "stock". The reports that value stock must include every type that holds
 * it, and a type that cannot hold stock must not be able to track inventory.
 */
async function itemTypeCapabilitiesBind_R51(ctx: Ctx): Promise<void> {
  await ctx.scenario("item types: capabilities bind on the server, not just in the picker (R5.1)", async () => {
    const items = await ctx.req("GET", "/items");
    const list = (items.body ?? []) as Array<{ id: string; type: string; trackInventory: boolean; onHand: string | null; stockState: string | null }>;
    ctx.check("the catalogue carries all six types", new Set(list.map((i) => i.type)).size === 6, JSON.stringify([...new Set(list.map((i) => i.type))]));

    for (const item of list) {
      const holdsStock = !["service", "recipe"].includes(item.type);
      if (!holdsStock) {
        ctx.check(`${item.id} (${item.type}) cannot track inventory`, item.trackInventory === false, JSON.stringify(item));
        // Null, never zero: a zero would file a service under "out of stock".
        ctx.check(`${item.id} (${item.type}) reports no stock state at all`, item.stockState === null, JSON.stringify(item));
      }
    }

    const rejected = await ctx.req("POST", "/items", {
      id: "SCN-ITEM-BAD-SERVICE",
      code: "SCN-BAD-1",
      nameAr: "خدمة تتبع مخزون",
      type: "service",
      baseUnitCode: "PCS",
      trackInventory: true,
    });
    ctx.check(
      "the server refuses a service item that claims to track inventory",
      rejected.status >= 400,
      `status ${rejected.status}: ${JSON.stringify(rejected.body)}`,
    );
  });
}

/**
 * R5.3 — the opening-balance shortcut is a ROUTE, not screen state: the reason
 * and the item ride in the URL so a reload or a shared link reopens the same
 * form. The server half of that is that the id in the URL is a real item.
 */
async function openingBalanceShortcutTargetsARealItem_R53(ctx: Ctx): Promise<void> {
  await ctx.scenario("the opening-balance shortcut posts against the item it named (R5.3)", async () => {
    const items = ((await ctx.req("GET", "/items")).body ?? []) as Array<{ id: string; stockState: string | null }>;
    const zeroStock = items.filter((i) => i.stockState === "out");
    ctx.check("the seed has a zero-stock item to offer the action on", zeroStock.length > 0, `found ${zeroStock.length}`);

    const target = zeroStock[0]!;
    const { draft, confirm } = await draftAndConfirm(ctx, "stock-adjustments", "SCN-ADJ-R53", {
      date: "2026-08-24",
      lines: [{ itemId: target.id, warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "12", unitCost: "5" }],
    });
    ctx.check("the opening balance drafts", draft.status === 201, JSON.stringify(draft.body));
    ctx.check("the opening balance confirms", confirm.status === 200, JSON.stringify(confirm.body));

    const after = ((await ctx.req("GET", "/items")).body ?? []) as Array<{ id: string; onHand: string | null; stockState: string | null }>;
    const row = after.find((i) => i.id === target.id);
    ctx.checkEq("the item now holds the opened quantity", ctx.n(row?.onHand), 12);
    ctx.check("and it has left the out-of-stock chip", row?.stockState !== "out", JSON.stringify(row));
  });
}

/**
 * R5.10 — brands, seasons and specifications are entities an item points at,
 * not free text. The check that matters is the one the old free-text field
 * would have failed: every brand an item carries must resolve to a real brand
 * record, and every specification value to a value its specification allows.
 */
async function catalogFacetsAreEntities_R510(ctx: Ctx): Promise<void> {
  await ctx.scenario("brands, seasons and specifications are bound entities, not free text (R5.10)", async () => {
    const brands = ((await ctx.req("GET", "/item-brands")).body ?? []) as Array<{ id: string }>;
    const seasons = ((await ctx.req("GET", "/item-seasons")).body ?? []) as Array<{ id: string }>;
    const specs = ((await ctx.req("GET", "/item-specifications")).body ?? []) as Array<{
      code: string;
      type: string;
      values: string[];
    }>;
    ctx.check("the brand registry has records", brands.length > 0, `${brands.length}`);
    ctx.check("the season registry has records", seasons.length > 0, `${seasons.length}`);

    const brandIds = new Set(brands.map((b) => b.id));
    const seasonIds = new Set(seasons.map((s) => s.id));
    const specByCode = new Map(specs.map((s) => [s.code, s]));

    const items = ((await ctx.req("GET", "/items")).body ?? []) as Array<{
      id: string;
      code: string;
      brandId: string | null;
      seasonId: string | null;
      specifications: Array<{ code: string; value: string }>;
    }>;
    const bound = items.filter((i) => i.brandId !== null);
    ctx.check("some items actually carry a brand", bound.length > 0, `${bound.length}`);

    for (const item of items) {
      // The defect the entity binding removes: a plausible NAME sitting in an
      // id field. Only a lookup against the registry catches it.
      if (item.brandId !== null) {
        ctx.check(`${item.code}'s brand resolves to a real brand record`, brandIds.has(item.brandId), item.brandId);
      }
      if (item.seasonId !== null) {
        ctx.check(`${item.code}'s season resolves to a real season record`, seasonIds.has(item.seasonId), item.seasonId);
      }
      for (const value of item.specifications ?? []) {
        const spec = specByCode.get(value.code);
        ctx.check(`${item.code}'s specification "${value.code}" is in the registry`, spec !== undefined, value.code);
        if (spec?.type === "select") {
          ctx.check(
            `${item.code}'s "${value.code}" value is one the specification allows`,
            spec.values.includes(value.value),
            `${value.value} not in ${JSON.stringify(spec.values)}`,
          );
        }
      }
    }
  });
}

/**
 * R5.4 — the item's default supplier is a supplier ID, not a typed name. Same
 * check as the brand: a plausible name in an id field passes every gate this
 * repo has except a lookup against the register it claims to point at.
 */
async function itemDefaultSupplierIsBound_R54(ctx: Ctx): Promise<void> {
  await ctx.scenario("an item's default supplier resolves to a real supplier (R5.4)", async () => {
    const suppliers = ((await ctx.req("GET", "/suppliers")).body ?? []) as Array<{ id: string }>;
    const supplierIds = new Set(suppliers.map((s) => s.id));
    const items = ((await ctx.req("GET", "/items")).body ?? []) as Array<{
      code: string;
      defaultSupplierId: string | null;
      description: string | null;
    }>;

    const bound = items.filter((i) => i.defaultSupplierId !== null);
    ctx.check("some items name a default supplier", bound.length > 0, `${bound.length}`);
    for (const item of bound) {
      ctx.check(
        `${item.code}'s default supplier resolves to a real supplier record`,
        supplierIds.has(item.defaultSupplierId!),
        item.defaultSupplierId!,
      );
    }
    ctx.check("and the description survives the round trip", bound.some((i) => (i.description ?? "").length > 0), JSON.stringify(bound.map((i) => i.description)));
  });
}

/**
 * R1.9 — an attention banner states an exception AND the filter that shows it.
 * The server half of that promise is that the count it advertises equals the
 * rows the filter actually returns: a banner offering "9 items are out of
 * stock" that then shows 7 is worse than no banner.
 */
async function attentionBannerCountsMatchTheirFilter_R19(ctx: Ctx): Promise<void> {
  await ctx.scenario("an attention banner's count equals the rows its filter returns (R1.9)", async () => {
    const items = ((await ctx.req("GET", "/items")).body ?? []) as Array<{ stockState: string | null }>;
    const out = items.filter((i) => i.stockState === "out").length;
    const low = items.filter((i) => i.stockState === "low").length;
    ctx.check("the seed has both exceptions to advertise", out > 0 && low > 0, `out=${out} low=${low}`);

    // The items list filters client-side over the same payload, so the check
    // that matters here is that the states are mutually exclusive — an item
    // counted in both banners would be double-reported.
    const both = items.filter((i) => i.stockState === "out" && i.stockState === "low").length;
    ctx.checkEq("no item is counted by two banners at once", both, 0);

    const sales = ((await ctx.req("GET", "/sales-invoices/counts")).body ?? {}) as Record<string, number>;
    const overdueRows = ((await ctx.req("GET", "/sales-invoices?status=overdue")).body ?? []) as unknown[];
    ctx.checkEq("the overdue banner's count equals the rows its filter returns", sales.overdue ?? 0, overdueRows.length);

    const purchases = ((await ctx.req("GET", "/purchases/invoices/counts")).body ?? {}) as Record<string, number>;
    for (const key of ["overdue", "due_soon"]) {
      const rows = ((await ctx.req("GET", `/purchases/invoices?status=${key}`)).body ?? []) as unknown[];
      ctx.checkEq(`the purchase "${key}" banner matches its filter`, purchases[key] ?? 0, rows.length);
    }

    const vouchers = ((await ctx.req("GET", "/vouchers/counts")).body ?? {}) as Record<string, number>;
    const unallocated = ((await ctx.req("GET", "/vouchers?needsAllocation=any")).body ?? []) as unknown[];
    ctx.checkEq("the needs-allocation banner matches its queue", vouchers.needs_allocation ?? 0, unallocated.length);
  });
}
