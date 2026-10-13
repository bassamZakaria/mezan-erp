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

async function restated(side: FxSide): Promise<string> {
  books = await openFxBooks();
  await books.invoice(side);
  const runId = await books.revalue("48.45");
  await books.rate("fx-settle", "48.70", "2026-09-10");
  expect(books.fx(side)).toEqual({ control: carried(side, 48_450n * SCALE), unrealised: pnl(side, RESTATED), realised: major(0n) });
  return runId;
}

async function numberAt(path: string, field = "docNo"): Promise<string> {
  const number = (await books.world.request("GET", path)).body[field];
  expect(String(number), path).toMatch(/\d/);
  return String(number);
}

const invoiceNumber = (side: FxSide) => (side === FxSide.Receivable ? numberAt("/sales-invoices/inv-usd") : numberAt("/purchases/invoices/pi-usd", "number"));

async function consumerNumber(path: ReliefPath, side: FxSide, usd: bigint): Promise<string> {
  if (path === ReliefPath.Settlement) return numberAt(`/vouchers/v-${usd}`);
  if (path === ReliefPath.Cheque) return `N-chq-${usd}`;
  if (path === ReliefPath.Return) return numberAt(`/${side === FxSide.Receivable ? "sales-returns" : "purchase-returns"}/ret-${usd}`);
  return invoiceNumber(side);
}

async function reverseRun(runId: string) {
  return books.world.request("POST", `/revaluation/runs/${runId}/reverse`, { memo: "سبب العكس", date: "2026-09-15" });
}

async function expectRunHeldBy(runId: string, documentNo: string): Promise<void> {
  const before = { ledger: books.world.sqlite.prepare("SELECT COUNT(*) AS n FROM journal_entry").get(), shares: books.world.sqlite.prepare("SELECT COUNT(*) AS n FROM fx_revaluation_share").get() };
  const refused = await reverseRun(runId);
  expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 FX_REVALUATION_SHARE_CONSUMED");
  expect(String(refused.body.message)).toContain(documentNo);
  expect(String(refused.body.message)).toMatch(/[\u0600-\u06FF]/);
  expect(refused.body.consumedBy).toBe(documentNo);
  expect({ ledger: books.world.sqlite.prepare("SELECT COUNT(*) AS n FROM journal_entry").get(), shares: books.world.sqlite.prepare("SELECT COUNT(*) AS n FROM fx_revaluation_share").get() }).toEqual(before);
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

describe("a run whose share a standing document has taken cannot be reversed out from under it", () => {
  const taken = SIDES.flatMap((side) => [
    ...Object.values(ReliefPath).map((path) => ({ side, path, usd: 1000n as const })),
    ...[ReliefPath.Settlement, ReliefPath.Cheque, ReliefPath.Return].map((path) => ({ side, path, usd: 400n as const })),
  ]);
  it.each(taken)("$side relieved of USD $usd by $path: reversing the run is refused in Arabic naming the document, and the books do not move", async ({ side, path, usd }) => {
    const runId = await restated(side);
    await relieve(path, side, usd);
    const held = books.fx(side);

    await expectRunHeldBy(runId, await consumerNumber(path, side, usd));

    expect(books.fx(side)).toEqual(held);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  async function restatedOnAccount(side: FxSide, extra: Record<string, unknown> = {}): Promise<string> {
    books = await openFxBooks();
    await books.voucher(side, "v-held", "1000", { date: "2026-08-22", currency: "USD", ...extra });
    const runId = await books.revalue("48.45");
    await books.rate("fx-settle", "48.70", "2026-09-10");
    return runId;
  }

  it.each(SIDES)("%s: restated money on account whose voucher was reversed holds the run, and the residue check agrees with the control account", async (side) => {
    const runId = await restatedOnAccount(side);
    const voucherNo = await numberAt("/vouchers/v-held");
    await books.ok("POST", "/vouchers/v-held/reverse", { memo: "أُدخل بالخطأ", date: "2026-09-10" }, 201);

    await expectRunHeldBy(runId, voucherNo);

    expect(major(books.world.balance(side === FxSide.Receivable ? "1105" : "2100"))).toBe(major(0n));
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: restated money on account that was refunded holds the run", async (side) => {
    const runId = await restatedOnAccount(side);
    const refund = side === FxSide.Receivable ? { voucherType: "customer_refund", customerId: "cust-usd" } : { voucherType: "supplier_refund", supplierId: "sup-usd" };
    await books.ok("POST", "/vouchers", { id: "v-refund", date: "2026-09-10", amount: "1000", currency: "USD", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: side === FxSide.Receivable ? "1105" : "2100", ...refund });
    await books.ok("POST", "/vouchers/v-refund/confirm", {}, 200);

    await expectRunHeldBy(runId, await numberAt("/vouchers/v-refund"));

    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: restated money whose cheque bounced holds the run", async (side) => {
    const runId = await restatedOnAccount(side, { paymentMethod: "cheque", referenceNo: "CHQ-78" });
    const voucherNo = await numberAt("/vouchers/v-held");
    await books.ok("POST", "/cheques/v-held/deposit", { bankTreasuryAccountId: "ta-bank" }, 200);
    await books.ok("POST", "/cheques/v-held/bounce", { date: "2026-09-10" }, 200);

    await expectRunHeldBy(runId, voucherNo);

    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: once the cheque that settled the invoice bounces nothing holds the run any more, and reversing it takes the 450 back off the invoice", async (side) => {
    const runId = await restated(side);
    await books.cheque(side, "chq-1", "48700");
    await books.allocateCheque(side, "chq-1", "48700");
    await books.ok("POST", "/cheques/chq-1/deposit", { bankTreasuryAccountId: "ta-bank" }, 200);
    await expectRunHeldBy(runId, "N-chq-1");
    await books.ok("POST", "/cheques/chq-1/bounce", { date: "2026-09-12" }, 200);

    const reversed = await reverseRun(runId);

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect(books.fx(side)).toEqual({ control: carried(side, 48_000n * SCALE), unrealised: major(0n), realised: major(0n) });
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
