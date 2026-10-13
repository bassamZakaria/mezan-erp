import { afterEach, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";
import { FX_CONTROL, FX_INVOICE_ID, FxSide, major, openFxBooks, type FxBooks } from "./test-helpers/fx-books.js";

const SCALE = 1_000_000n;
const SIDES = [FxSide.Receivable, FxSide.Payable] as const;
const REFUND_TYPE: Record<FxSide, Record<string, string>> = {
  [FxSide.Receivable]: { voucherType: "customer_refund", customerId: "cust-usd" },
  [FxSide.Payable]: { voucherType: "supplier_refund", supplierId: "sup-usd" },
};

let books: FxBooks;

afterEach(() => books?.world.close());

const mirrored = (side: FxSide, scaled: bigint) => major(side === FxSide.Receivable ? scaled : -scaled);

async function onAccount(side: FxSide, id: string, usd: string): Promise<void> {
  await books.voucher(side, id, usd, { date: "2026-08-22", currency: "USD" });
}

async function refund(side: FxSide, id: string, usd: string): Promise<void> {
  await books.ok("POST", "/vouchers", { id, date: "2026-09-10", amount: usd, currency: "USD", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: FX_CONTROL[side], ...REFUND_TYPE[side] });
  await books.ok("POST", `/vouchers/${id}/confirm`, {}, 200);
}

function shares(): { item: string; type: string; amount: string }[] {
  const rows = books.world.sqlite.prepare("SELECT item_id, item_type, amount FROM fx_revaluation_share ORDER BY item_id, entry_id").safeIntegers().all() as { item_id: string; item_type: string; amount: bigint }[];
  return rows.map((row) => ({ item: row.item_id, type: row.item_type, amount: major(row.amount) }));
}

async function residueRows(): Promise<unknown[]> {
  return ((await books.world.request("GET", "/revaluation/residue")).body.rows as unknown[]) ?? [];
}

async function unallocated(voucherId: string): Promise<string> {
  const voucher = (await books.world.request("GET", `/vouchers/${voucherId}`)).body as { allocationSummary?: { unallocated?: string } };
  return String(voucher.allocationSummary?.unallocated);
}

async function allocationsOf(voucherId: string): Promise<Record<string, unknown>[]> {
  return (await books.world.request("GET", `/vouchers/${voucherId}/allocations`)).body.allocations as Record<string, unknown>[];
}

async function numberOf(side: FxSide): Promise<string> {
  const path = side === FxSide.Receivable ? `/sales-invoices/${FX_INVOICE_ID[side]}` : `/purchases/invoices/${FX_INVOICE_ID[side]}`;
  const invoice = (await books.world.request("GET", path)).body;
  return String(side === FxSide.Receivable ? invoice.docNo : invoice.number);
}

async function restatedOnAccount(side: FxSide): Promise<string> {
  books = await openFxBooks();
  await onAccount(side, "v-held", "1000");
  const runId = await books.revalue("48.45");
  await books.rate("fx-settle", "48.70", "2026-09-10");
  expect(books.fx(side)).toEqual({ control: mirrored(side, -48_450n * SCALE), unrealised: mirrored(side, -450n * SCALE), realised: major(0n) });
  expect(shares()).toEqual([{ item: "v-held", type: "money", amount: "-450.000000" }]);
  return runId;
}

describe("foreign money held on account is an open item of its own", () => {
  it.each(SIDES)("%s: USD 1,000 on account restated by 450 and then applied to an invoice booked at 48.70 — 450 unrealised, 250 realised, nothing left on the control account", async (side) => {
    const runId = await restatedOnAccount(side);
    await books.invoice(side, FX_INVOICE_ID[side], { date: "2026-09-10" });

    await books.ok("POST", "/vouchers/v-held/allocations", { allocationId: "al-held", invoiceId: FX_INVOICE_ID[side], amount: "48000" });

    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: mirrored(side, -450n * SCALE), realised: mirrored(side, -250n * SCALE) });
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
    expect(await allocationsOf("v-held")).toEqual([
      expect.objectContaining({ invoiceNo: await numberOf(side), amount: "48000.000000", moneyRevaluationShare: "-450.000000", moneyCarryingAmount: "48450.000000", carryingAmount: "48700.000000", fxDifference: "-250.000000" }),
    ]);
    const refused = await books.world.request("POST", `/revaluation/runs/${runId}/reverse`, { memo: "سبب العكس" });
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 FX_REVALUATION_SHARE_CONSUMED");

    await books.ok("POST", "/allocations/al-held/reverse", {}, 200);

    expect(books.fx(side)).toEqual({ control: mirrored(side, 250n * SCALE), unrealised: mirrored(side, -450n * SCALE), realised: major(0n) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: money that arrived by cheque and is applied from the cheque register gives up its restatement the same way", async (side) => {
    books = await openFxBooks();
    await books.voucher(side, "v-held", "1000", { date: "2026-08-22", currency: "USD", paymentMethod: "cheque", referenceNo: "CHQ-77" });
    await books.revalue("48.45");
    await books.rate("fx-settle", "48.70", "2026-09-10");
    await books.invoice(side, FX_INVOICE_ID[side], { date: "2026-09-10" });
    expect(shares()).toEqual([{ item: "v-held", type: "money", amount: "-450.000000" }]);

    await books.ok("POST", "/cheques/v-held/allocations", { allocationId: "al-held", invoiceId: FX_INVOICE_ID[side], amount: "48000" });

    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: mirrored(side, -450n * SCALE), realised: mirrored(side, -250n * SCALE) });
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: restated money whose cheque bounces was never held, and its restatement goes back with it", async (side) => {
    books = await openFxBooks();
    await books.voucher(side, "v-held", "1000", { date: "2026-08-22", currency: "USD", paymentMethod: "cheque", referenceNo: "CHQ-78" });
    await books.revalue("48.45");
    await books.ok("POST", "/cheques/v-held/deposit", { bankTreasuryAccountId: "ta-bank" }, 200);

    await books.ok("POST", "/cheques/v-held/bounce", { date: "2026-09-10" }, 200);

    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: mirrored(side, -450n * SCALE), realised: mirrored(side, 450n * SCALE) });
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: USD 1,000 on account restated by 450 and then refunded at 48.70 — the refund is measured against the money it gives back: 450 unrealised, 250 realised, and the receipt has nothing left to allocate", async (side) => {
    await restatedOnAccount(side);

    await refund(side, "v-refund", "1000");

    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: mirrored(side, -450n * SCALE), realised: mirrored(side, -250n * SCALE) });
    expect(await unallocated("v-held")).toBe("0.000000");
    const refundNo = String((await books.world.request("GET", "/vouchers/v-refund")).body.docNo);
    expect(refundNo).toMatch(/\d/);
    expect(await allocationsOf("v-held")).toEqual([expect.objectContaining({ invoiceId: "v-refund", invoiceNo: refundNo, status: "active" })]);
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);

    await books.ok("POST", "/vouchers/v-refund/reverse", { memo: "أُدخل بالخطأ", date: "2026-09-10" }, 201);

    expect(books.fx(side)).toEqual({ control: mirrored(side, -48_450n * SCALE), unrealised: mirrored(side, -450n * SCALE), realised: major(0n) });
    expect(await unallocated("v-held")).toBe("48000.000000");
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: USD 400 of it applied to an invoice takes 180 of its restatement, and refunding the other USD 600 takes the 270 left", async (side) => {
    await restatedOnAccount(side);
    await books.invoice(side, FX_INVOICE_ID[side], { date: "2026-09-10", units: "4" });

    await books.ok("POST", "/vouchers/v-held/allocations", { allocationId: "al-held", invoiceId: FX_INVOICE_ID[side], amount: "19200" });

    expect(books.fx(side)).toEqual({ control: mirrored(side, -29_070n * SCALE), unrealised: mirrored(side, -450n * SCALE), realised: mirrored(side, -100n * SCALE) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);

    await refund(side, "v-refund", "600");

    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: mirrored(side, -450n * SCALE), realised: mirrored(side, -250n * SCALE) });
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: restated money on account whose voucher is reversed gives its restatement back, since the money was never held", async (side) => {
    await restatedOnAccount(side);

    await books.ok("POST", "/vouchers/v-held/reverse", { memo: "أُدخل بالخطأ", date: "2026-09-10" }, 201);

    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: mirrored(side, -450n * SCALE), realised: mirrored(side, 450n * SCALE) });
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: beside an open invoice each item carries its own restatement only — the invoice 450, the USD 300 held on account −135 — and the shares are the run's posting to the micro-unit", async (side) => {
    books = await openFxBooks();
    await books.invoice(side);
    await onAccount(side, "v-held", "300");
    const before = books.world.balance(FX_CONTROL[side]);

    await books.revalue("48.45");

    expect(shares()).toEqual([
      { item: FX_INVOICE_ID[side], type: "invoice", amount: "450.000000" },
      { item: "v-held", type: "money", amount: "-135.000000" },
    ]);
    expect(major(books.world.balance(FX_CONTROL[side]) - before)).toBe(mirrored(side, 315n * SCALE));
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: an invoice booked after the day being revalued takes none of that day's restatement", async (side) => {
    books = await openFxBooks();
    await books.invoice(side);
    await books.rate("fx-later", "48.70", "2026-09-10");
    await books.invoice(side, "inv-later", { date: "2026-09-10" });

    await books.revalue("48.45");

    expect(shares()).toEqual([{ item: FX_INVOICE_ID[side], type: "invoice", amount: "450.000000" }]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("three items at a rate that does not divide: the shares still add up to exactly what the run posted to the control account", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable, "inv-a", { units: "3.333333" });
    await books.invoice(FxSide.Receivable, "inv-b", { units: "1.111111" });
    await onAccount(FxSide.Receivable, "v-held", "77.777777");
    const before = books.world.balance("1105");

    await books.revalue("48.123457");

    const posted = books.world.balance("1105") - before;
    const rows = shares();
    expect(rows.map((row) => row.item)).toEqual(["inv-a", "inv-b", "v-held"]);
    expect(rows.reduce((sum, row) => sum + BigInt(row.amount.replace(".", "")), 0n)).toBe(posted);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
