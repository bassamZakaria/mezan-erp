import { afterEach, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";
import { FxSide, major, openFxBooks, type FxBooks } from "./test-helpers/fx-books.js";

enum ReliefPath {
  Settlement = "settlement",
  Cheque = "cheque",
  Return = "return",
  Void = "void",
}

const SCALE = 1_000_000n;
const SIDES = [FxSide.Receivable, FxSide.Payable] as const;
const RESTATED = 450n * SCALE;
const SETTLED_ABOVE_BOOKED_PER_USD = 700_000n;

let books: FxBooks;

afterEach(() => books?.world.close());

const mirrored = (side: FxSide, scaled: bigint) => major(side === FxSide.Receivable ? scaled : -scaled);
const pnl = mirrored;
const carried = mirrored;

async function restated(side: FxSide): Promise<void> {
  books = await openFxBooks();
  await books.invoice(side);
  await books.revalue("48.45");
  await books.rate("fx-settle", "48.70", "2026-09-10");
  expect(books.fx(side)).toEqual({ control: carried(side, 48_450n * SCALE), unrealised: pnl(side, RESTATED), realised: major(0n) });
}

async function relieve(path: ReliefPath, side: FxSide, usd: 400n | 1000n): Promise<void> {
  const base = major(usd * 48_700_000n);
  if (path === ReliefPath.Settlement) await books.settle(side, `v-${usd}`, base);
  if (path === ReliefPath.Cheque) {
    await books.cheque(side, `chq-${usd}`, base);
    await books.allocateCheque(side, `chq-${usd}`, base);
  }
  if (path === ReliefPath.Return) await books.returnUnits(side, `ret-${usd}`, String(usd / 100n));
  if (path === ReliefPath.Void) await books.voidInvoice(side);
}

const settlesMoney = (path: ReliefPath) => path === ReliefPath.Settlement || path === ReliefPath.Cheque;

function realisedBy(path: ReliefPath, usd: bigint): bigint {
  const shareTaken = (RESTATED * usd) / 1000n;
  return settlesMoney(path) ? usd * SETTLED_ABOVE_BOOKED_PER_USD - shareTaken : -shareTaken;
}

async function backdatedReturn(side: FxSide): Promise<Record<string, unknown>> {
  if (side === FxSide.Receivable) return { id: "ret-early", date: "2026-08-25", memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: "inv-usd", reason: "OTHER", requested: [{ itemId: "SVC-1", qty: "4" }] };
  const bill = (await books.world.request("GET", "/purchases/invoices/pi-usd")).body;
  return {
    id: "ret-early", date: "2026-08-25", memo: "",
    lines: [{ itemId: "STK-1", warehouseId: "WH-MAIN", supplierId: "sup-usd", sourceInvoiceId: "pi-usd", sourceInvoiceNumber: String(bill.number), reason: "DEFECTIVE", availableQty: "10", qty: "4", unitCost: "100", taxAmount: "0" }],
  };
}

async function residueRows(): Promise<unknown[]> {
  return ((await books.world.request("GET", "/revaluation/residue")).body.rows as unknown[]) ?? [];
}

describe("whatever takes foreign money off an open item relieves it at what it is carried at", () => {
  const whole = SIDES.flatMap((side) => Object.values(ReliefPath).map((path) => ({ side, path })));
  it.each(whole)("$side cleared in full by $path: the control account holds nothing, and unrealised plus realised is what the money actually made", async ({ side, path }) => {
    await restated(side);

    await relieve(path, side, 1000n);

    const realised = realisedBy(path, 1000n);
    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: pnl(side, RESTATED), realised: pnl(side, realised) });
    expect(RESTATED + realised).toBe(settlesMoney(path) ? 1000n * SETTLED_ABOVE_BOOKED_PER_USD : 0n);
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  const partial = SIDES.flatMap((side) => [ReliefPath.Settlement, ReliefPath.Cheque, ReliefPath.Return].map((path) => ({ side, path })));
  it.each(partial)("$side relieved of USD 400 by $path stays carried at 29,070 for the USD 600 left, and paying those leaves nothing", async ({ side, path }) => {
    await restated(side);

    await relieve(path, side, 400n);

    const first = realisedBy(path, 400n);
    expect(books.fx(side)).toEqual({ control: carried(side, 29_070n * SCALE), unrealised: pnl(side, RESTATED), realised: pnl(side, first) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);

    await books.settle(side, "v-rest", "29220");

    const realised = first + realisedBy(ReliefPath.Settlement, 600n);
    const settledUsd = settlesMoney(path) ? 1000n : 600n;
    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: pnl(side, RESTATED), realised: pnl(side, realised) });
    expect(RESTATED + realised).toBe(settledUsd * SETTLED_ABOVE_BOOKED_PER_USD);
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: a cheque that bounces gives the restatement back, and the cheque that replaces it consumes it again", async (side) => {
    await restated(side);
    await books.cheque(side, "chq-1", "48700");
    await books.allocateCheque(side, "chq-1", "48700");
    await books.ok("POST", "/cheques/chq-1/deposit", { bankTreasuryAccountId: "ta-bank" }, 200);

    await books.ok("POST", "/cheques/chq-1/bounce", { date: "2026-09-12" }, 200);

    expect(books.fx(side)).toEqual({ control: carried(side, 48_450n * SCALE), unrealised: pnl(side, RESTATED), realised: major(0n) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);

    if (side === FxSide.Receivable) {
      await books.ok("POST", "/cheques/chq-1/replace", { newCheque: { id: "chq-2", chequeNumber: "N-chq-2", bankName: "بنك مصر", issueDate: "2026-09-12", dueDate: "2026-09-12", branchId: "BR-MAIN" }, date: "2026-09-12" });
    } else {
      await books.cheque(side, "chq-2", "48700");
    }
    await books.allocateCheque(side, "chq-2", "48700");

    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: pnl(side, RESTATED), realised: pnl(side, 250n * SCALE) });
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: a return dated before the revaluation gives its share up on the revaluation's own day, never before the restatement exists", async (side) => {
    await restated(side);
    await books.ok("POST", side === FxSide.Receivable ? "/sales-returns/from-invoice" : "/purchase-returns", await backdatedReturn(side));
    await books.ok("POST", `/${side === FxSide.Receivable ? "sales-returns" : "purchase-returns"}/ret-early/confirm`, {}, 200);

    const account = side === FxSide.Receivable ? "1105" : "2100";
    expect(major(books.world.balance(account, "2026-08-30"))).toBe(carried(side, 28_800n * SCALE));
    expect(major(books.world.balance(account, "2026-08-31"))).toBe(carried(side, 29_070n * SCALE));
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: undoing the settlement of a part-returned item gives back only what the settlement took", async (side) => {
    await restated(side);
    await relieve(ReliefPath.Return, side, 400n);
    await books.settle(side, "v-rest", "29220");

    await books.ok("POST", "/allocations/al-v-rest/reverse", {}, 200);

    expect(books.fx(side)).toEqual({ control: carried(side, -150n * SCALE), unrealised: pnl(side, RESTATED), realised: pnl(side, -180n * SCALE) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
