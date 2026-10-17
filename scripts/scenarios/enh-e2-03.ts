import type { ScenarioFragment } from "./fragments.js";

const BRANCH = "BR-MAIN";
const WH = "WH-SCN-CNT";
const ITEM_SHORT = "SCN-CNT-X";
const ITEM_RECOUNT = "SCN-CNT-Y";
const ITEM_EXACT = "SCN-CNT-Z";
const COUNT_VARIANCE_ACCOUNT = "5074";
const ADJUSTMENT = "SCN-CNT-ADJ";
const REVIEWER = { "x-user-id": "SCN-CNT-REVIEWER", "x-permissions": "inventory.count.review,inventory.count.approve,inventory.count.scan", "x-role-codes": "INVENTORY_MANAGER" };
const COUNTER_PERMISSIONS = "inventory.count.scan,inventory.count.review,inventory.count.approve";

/**
 * Count mode (ENH-E2-03) — a blind, zoned count on a store of its own. Zone A
 * holds a short item (50 on the books at 10, counted 48) and one the reviewer
 * sends back for a recount (30 at 8: first 35, then 31); zone B an item that
 * counts exactly (20 at 5). The generated adjustment must post the net
 * −20 + 8 = −12 against 1200 and the count-variance account.
 */
export const scenario: ScenarioFragment = {
  smokePaths: ["/inventory/count-mode/mine"],

  async run(ctx) {
    const { scenario: it, req, n, check, checkEq, today } = ctx;
    const same = (label: string, actual: unknown, expected: unknown) => check(label, actual === expected, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
    const gl = async (code: string) => n((await req("GET", `/gl/accounts/${code}/ledger`)).body?.balance?.balance);
    const onHand = async (itemId: string) => {
      const b = (await req("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${WH}`)).body;
      return { onHand: n(b?.onHand), averageCost: n(b?.averageCost), totalValue: n(b?.totalValue) };
    };

    await it("count mode · zoned blind count, recount, independent zone approval, completion and the generated adjustment tie stock to GL", async () => {
      checkEq("a store is opened for the count", (await req("POST", "/warehouses", { id: WH, code: "WH-SCN-CNT", name: "مخزن الجرد", nameEn: "Count store", branchId: BRANCH })).status, 201);
      for (const [id, code, nameAr, qty, cost] of [
        [ITEM_SHORT, "SCN-CNT-X", "صنف العجز", "50", "10"],
        [ITEM_RECOUNT, "SCN-CNT-Y", "صنف إعادة العد", "30", "8"],
        [ITEM_EXACT, "SCN-CNT-Z", "صنف مطابق", "20", "5"],
      ] as const) {
        checkEq(`item ${code} is created`, (await req("POST", "/items", { id, code, nameAr, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" })).status, 201);
        await req("POST", "/inventory/stock-adjustments/draft", { id: `SCN-CNT-OPEN-${code}`, date: today, lines: [{ itemId: id, warehouseId: WH, reason: "INITIAL_STOCK", direction: "IN", qty, unitCost: cost }] });
        check(`and stocked with ${qty} at ${cost}`, (await req("POST", `/inventory/stock-adjustments/SCN-CNT-OPEN-${code}/confirm`, {})).ok);
      }

      const counters: any[] = ctx.rows((await req("GET", "/inventory/count-mode/counters")).body);
      check("the assigner is offered eligible counters", counters.length > 0, JSON.stringify(counters).slice(0, 200));
      const counterA: string = counters[0]?.userId;
      const counterB: string = (counters[1] ?? counters[0])?.userId;
      check("two different people count the two zones", Boolean(counterA && counterB) && counterA !== counterB, JSON.stringify(counters.map((c: any) => c.userId)));
      const asCounter = (userId: string) => ({ "x-user-id": userId, "x-permissions": COUNTER_PERMISSIONS });

      const stranger = await req("POST", "/inventory/count-mode", {
        warehouseId: WH,
        date: today,
        zones: [{ name: "غريب", kind: "AD_HOC", itemIds: [ITEM_SHORT], counterUserIds: ["SCN-CNT-NOBODY"] }],
      });
      checkEq("a counter without the scan permission cannot be assigned", stranger.status, 400);
      same("refused as not eligible", stranger.body?.error, "COUNTER_NOT_ELIGIBLE");

      const started = await req("POST", "/inventory/count-mode", {
        warehouseId: WH,
        date: today,
        blind: true,
        memo: "جرد سيناريو بالمناطق",
        zones: [
          { name: "الرف أ", kind: "AD_HOC", itemIds: [ITEM_SHORT, ITEM_RECOUNT], counterUserIds: [counterA] },
          { name: "الرف ب", kind: "AD_HOC", itemIds: [ITEM_EXACT], counterUserIds: [counterB] },
        ],
      });
      checkEq("a zoned count starts", started.status, 201);
      const countId: string = started.body?.id;
      const zoneA: string = (started.body?.zones ?? []).find((z: any) => z.name === "الرف أ")?.id;
      const zoneB: string = (started.body?.zones ?? []).find((z: any) => z.name === "الرف ب")?.id;
      check("with its two zones", Boolean(countId && zoneA && zoneB), JSON.stringify(started.body?.zones));
      const scan = (zoneId: string, userId: string, body: Record<string, unknown>) => req("POST", `/inventory/count-mode/${countId}/zones/${zoneId}/scan`, body, asCounter(userId));

      checkEq("the short item is counted 40", (await scan(zoneA, counterA, { itemId: ITEM_SHORT, mode: "ADD", qty: "40" })).status, 201);
      const added = await scan(zoneA, counterA, { itemId: ITEM_SHORT, mode: "ADD", qty: "8" });
      checkEq("then 8 more on the same shelf", n(added.body?.item?.countedQty), 48);
      same("a blind counter never sees the book quantity", added.body?.item?.systemQty, null);
      checkEq("the recount item is first counted 35", n((await scan(zoneA, counterA, { itemId: ITEM_RECOUNT, mode: "SET", qty: "35" })).body?.item?.countedQty), 35);
      const notMine = await scan(zoneB, counterA, { itemId: ITEM_EXACT, mode: "SET", qty: "20" });
      checkEq("a counter cannot scan in a zone they are not assigned to", notMine.status, 403);
      checkEq("zone B is counted by its own counter", (await scan(zoneB, counterB, { itemId: ITEM_EXACT, mode: "SET", qty: "20" })).status, 201);

      checkEq("zone A is submitted", (await req("POST", `/inventory/count-mode/${countId}/zones/${zoneA}/submit`, {}, asCounter(counterA))).status, 200);
      checkEq("zone B is submitted", (await req("POST", `/inventory/count-mode/${countId}/zones/${zoneB}/submit`, {}, asCounter(counterB))).status, 200);

      const review = (await req("GET", `/inventory/count-mode/${countId}`, undefined, REVIEWER)).body;
      const reviewLine = (itemId: string) => (review?.items ?? []).find((i: any) => i.itemId === itemId);
      checkEq("the independent reviewer sees the short item's variance", n(reviewLine(ITEM_SHORT)?.varianceQty), -2);
      checkEq("valued at its WAC", n(reviewLine(ITEM_SHORT)?.varianceValue), -20);
      checkEq("and the suspicious +5 on the other", n(reviewLine(ITEM_RECOUNT)?.varianceQty), 5);

      const selfApproval = await req("POST", `/inventory/count-mode/${countId}/zones/${zoneA}/approve`, {}, asCounter(counterA));
      checkEq("the zone's own counter may not approve it", selfApproval.status, 403);
      same("refused as self-review", selfApproval.body?.reason, "SELF_REVIEW");

      const recount = await req("POST", `/inventory/count-mode/${countId}/zones/${zoneA}/recount`, { itemIds: [ITEM_RECOUNT], reason: "زيادة غير مبررة" }, REVIEWER);
      checkEq("the reviewer flags the +5 for a recount", recount.status, 200);
      const reopened = (recount.body?.zones ?? []).find((z: any) => z.id === zoneA);
      same("which reopens the zone", reopened?.status, "OPEN");
      const flagged = (recount.body?.items ?? []).find((i: any) => i.itemId === ITEM_RECOUNT);
      check("and clears that item's count, marked for recount", flagged?.recount === true && flagged?.countedQty === null, JSON.stringify(flagged));
      checkEq("the zone cannot be submitted again until it is recounted", (await req("POST", `/inventory/count-mode/${countId}/zones/${zoneA}/submit`, {}, asCounter(counterA))).status, 409);
      checkEq("the recount finds 31", n((await scan(zoneA, counterA, { itemId: ITEM_RECOUNT, mode: "SET", qty: "31" })).body?.item?.countedQty), 31);
      checkEq("zone A is submitted again", (await req("POST", `/inventory/count-mode/${countId}/zones/${zoneA}/submit`, {}, asCounter(counterA))).status, 200);

      checkEq("zone A is approved by the reviewer", (await req("POST", `/inventory/count-mode/${countId}/zones/${zoneA}/approve`, {}, REVIEWER)).status, 200);
      const early = await req("POST", `/inventory/count-mode/${countId}/complete`, {}, REVIEWER);
      checkEq("the count cannot complete while zone B awaits approval", early.status, 409);
      same("refused as unapproved zones", early.body?.reason, "ZONES_NOT_APPROVED");
      checkEq("zone B is approved", (await req("POST", `/inventory/count-mode/${countId}/zones/${zoneB}/approve`, {}, REVIEWER)).status, 200);
      const completed = await req("POST", `/inventory/count-mode/${countId}/complete`, {}, REVIEWER);
      checkEq("the count completes", completed.status, 200);
      same("as COMPLETED", completed.body?.status, "COMPLETED");
      checkEq("its net variance is −20 + 8", n(completed.body?.netValue), -12);
      checkEq("completing moves no stock", (await onHand(ITEM_SHORT)).onHand, 50);

      const varianceBefore = await gl(COUNT_VARIANCE_ACCOUNT);
      const inventoryBefore = await gl("1200");
      const generated = await req("POST", `/inventory/physical-counts/${countId}/generate-adjustment`, { adjustmentId: ADJUSTMENT });
      checkEq("the adjustment is generated", generated.status, 200);
      const lines: any[] = generated.body?.adjustment?.lines ?? [];
      const lineOf = (itemId: string) => lines.find((l: any) => l.itemId === itemId);
      checkEq("with exactly the two lines that differ", lines.length, 2);
      check("the short item leaves by 2", lineOf(ITEM_SHORT)?.direction === "OUT" && n(lineOf(ITEM_SHORT)?.qty) === 2, JSON.stringify(lineOf(ITEM_SHORT)));
      check("the recounted item comes in by 1", lineOf(ITEM_RECOUNT)?.direction === "IN" && n(lineOf(ITEM_RECOUNT)?.qty) === 1, JSON.stringify(lineOf(ITEM_RECOUNT)));
      same("and the count records it", generated.body?.count?.generatedAdjustmentId ?? generated.body?.count?.adjustmentId, ADJUSTMENT);

      checkEq("stock now equals the count for the short item", (await onHand(ITEM_SHORT)).onHand, 48);
      checkEq("for the recounted item", (await onHand(ITEM_RECOUNT)).onHand, 31);
      checkEq("and the exact item is untouched", (await onHand(ITEM_EXACT)).onHand, 20);
      checkEq("1200 falls by the net 12.00", inventoryBefore - (await gl("1200")), 12);
      checkEq("the count-variance account takes the 12.00", (await gl(COUNT_VARIANCE_ACCOUNT)) - varianceBefore, 12);
      const je = (await req("GET", `/gl/journal-entries/${ADJUSTMENT}`)).body;
      const jeLines: any[] = je?.lines ?? [];
      checkEq("its journal entry balances", jeLines.reduce((s, l) => s + n(l.debit), 0), jeLines.reduce((s, l) => s + n(l.credit), 0));
      check("between 1200 and 5074 only", jeLines.length > 0 && jeLines.every((l) => l.accountId === "1200" || l.accountId === COUNT_VARIANCE_ACCOUNT), JSON.stringify(jeLines));

      const twice = await req("POST", `/inventory/physical-counts/${countId}/generate-adjustment`, { adjustmentId: `${ADJUSTMENT}-2` });
      checkEq("a second adjustment from the same count is refused", twice.status, 409);
      checkEq("and moves nothing", (await onHand(ITEM_SHORT)).onHand, 48);
    });
  },
};
