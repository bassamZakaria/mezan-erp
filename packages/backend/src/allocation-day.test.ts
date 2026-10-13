import { afterEach, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";
import { FX_CONTROL, FxSide, major, openFxBooks, type FxBooks } from "./test-helpers/fx-books.js";

enum Money {
  Voucher = "voucher",
  Cheque = "cheque",
}

const SCALE = 1_000_000n;
const ARABIC = /[؀-ۿ]/;

let books: FxBooks;

afterEach(() => books?.world.close());

async function baseInvoice(date: string): Promise<void> {
  await books.ok("POST", "/sales-invoices", {
    id: "inv-egp", date, dueDate: "2026-10-30", customerId: "cust-usd", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "10", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
  });
  await books.ok("POST", "/sales-invoices/inv-egp/confirm", {}, 200);
}

async function money(kind: Money, amount: string): Promise<string> {
  if (kind === Money.Voucher) {
    await books.voucher(FxSide.Receivable, "m-1", amount);
    return "/vouchers/m-1/allocations";
  }
  await books.cheque(FxSide.Receivable, "m-1", amount);
  return "/cheques/m-1/allocations";
}

const allocationDay = (id: string) => (books.world.sqlite.prepare("SELECT date FROM voucher_allocation WHERE id = ?").get(id) as { date: string | null } | undefined)?.date ?? null;

async function closeSeptember(): Promise<void> {
  const periods = (await books.world.request("GET", "/fiscal-periods")).body as unknown as { id: string; startDate: string; endDate: string }[];
  const september = periods.find((period) => period.startDate <= "2026-09-15" && period.endDate >= "2026-09-15")!;
  await books.ok("POST", `/fiscal-periods/${september.id}/close`, { overrideReason: "إقفال سبتمبر" }, 200);
}

describe("an allocation made after the money was received takes effect on the later of the money's day and the invoice's", () => {
  it.each(Object.values(Money))("%s dated 10 September against an invoice dated 15 September: no date sent means 15 September, and the answer says so", async (kind) => {
    books = await openFxBooks();
    await baseInvoice("2026-09-15");
    const url = await money(kind, "400");

    const made = await books.ok("POST", url, { allocationId: "al-1", invoiceId: "inv-egp", amount: "400" });

    expect(allocationDay("al-1")).toBe("2026-09-15");
    const reported = kind === Money.Voucher ? made.date : (made.allocations as { id: string; date: string }[]).find((row) => row.id === "al-1")?.date;
    expect(reported).toBe("2026-09-15");
  });

  it.each(Object.values(Money))("%s: a date before that day is refused in Arabic naming it; a later one is taken as sent", async (kind) => {
    books = await openFxBooks();
    await baseInvoice("2026-09-15");
    const url = await money(kind, "400");

    const early = await books.world.request("POST", url, { allocationId: "al-early", invoiceId: "inv-egp", amount: "100", date: "2026-09-14" });

    expect(`${early.status} ${String(early.body.error)}`).toBe("422 ALLOCATION_DATE_TOO_EARLY");
    expect(String(early.body.message)).toMatch(ARABIC);
    expect(String(early.body.message)).toContain("2026-09-15");
    expect(allocationDay("al-early")).toBeNull();

    await books.ok("POST", url, { allocationId: "al-late", invoiceId: "inv-egp", amount: "100", date: "2026-09-22" });
    expect(allocationDay("al-late")).toBe("2026-09-22");
  });

  it.each(Object.values(Money))("%s: when that day is in a closed period the allocation falls forward to the first open day, and a closed day asked for by name is refused naming it", async (kind) => {
    books = await openFxBooks();
    await baseInvoice("2026-09-15");
    const url = await money(kind, "400");
    await closeSeptember();

    const asked = await books.world.request("POST", url, { allocationId: "al-closed", invoiceId: "inv-egp", amount: "100", date: "2026-09-20" });

    expect(`${asked.status} ${String(asked.body.error)}`).toBe("422 PERIOD_NOT_OPEN_FOR_POSTING");
    expect(String(asked.body.message)).toMatch(ARABIC);
    expect(asked.body.earliestOpenDate).toBe("2026-10-01");
    expect(allocationDay("al-closed")).toBeNull();

    await books.ok("POST", url, { allocationId: "al-forward", invoiceId: "inv-egp", amount: "100" });
    expect(allocationDay("al-forward")).toBe("2026-10-01");
  });
});

describe("money or an invoice freed by an undone allocation is free from the day of the undo", () => {
  const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

  it.each(Object.values(Money))("%s: allocated, undone today and allocated again with no date — the second takes today, never a day on which the first still stood", async (kind) => {
    books = await openFxBooks();
    await baseInvoice("2026-09-15");
    const url = await money(kind, "400");
    await books.ok("POST", url, { allocationId: "al-1", invoiceId: "inv-egp", amount: "400" });
    await books.ok("POST", "/allocations/al-1/reverse", {}, 200);

    const early = await books.world.request("POST", url, { allocationId: "al-early", invoiceId: "inv-egp", amount: "400", date: "2026-09-20" });
    expect(`${early.status} ${String(early.body.error)}`).toBe("422 ALLOCATION_DATE_TOO_EARLY");
    expect(String(early.body.message)).toContain(TODAY);

    await books.ok("POST", url, { allocationId: "al-2", invoiceId: "inv-egp", amount: "400" });
    expect(allocationDay("al-2")).toBe(TODAY);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("a foreign invoice settled by an allocation made later", () => {
  async function usdInvoiceAndSeptemberMoney(): Promise<void> {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    await books.rate("fx-settle", "48.70", "2026-09-10");
    await books.rate("fx-sep", "48.95", "2026-09-30");
    await books.voucher(FxSide.Receivable, "m-1", "19480");
  }

  const realisedUpTo = (day: string) => major(-(books.world.balance("4920", day) + books.world.balance("5920", day)));

  it("the realised difference lands in the money's own month, not the month the allocation was keyed in", async () => {
    await usdInvoiceAndSeptemberMoney();

    await books.ok("POST", "/vouchers/m-1/allocations", { allocationId: "al-1", invoiceId: "inv-usd", amount: "19480" });

    expect(allocationDay("al-1")).toBe("2026-09-10");
    expect(realisedUpTo("2026-09-09")).toBe(major(0n));
    expect(realisedUpTo("2026-09-30")).toBe(major(280n * SCALE));
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("allocated on 2 October, with the September run posted afterwards: the run gives up its share of the USD 400 and the USD 600 left is carried at 29,370.00", async () => {
    await usdInvoiceAndSeptemberMoney();
    await books.ok("POST", "/vouchers/m-1/allocations", { allocationId: "al-1", invoiceId: "inv-usd", amount: "19480", date: "2026-10-02" });

    await books.ok("POST", "/revaluation/post", { date: "2026-09-30", currencies: ["USD"], autoReverse: false });

    expect(books.fx(FxSide.Receivable)).toEqual({ control: major(29_370n * SCALE), unrealised: major(950n * SCALE), realised: major(-100n * SCALE) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("with the September run already standing, no date sent means the day after the run — the same books as allocating on 2 October before it", async () => {
    await usdInvoiceAndSeptemberMoney();
    await books.ok("POST", "/revaluation/post", { date: "2026-09-30", currencies: ["USD"], autoReverse: false });

    const made = await books.ok("POST", "/vouchers/m-1/allocations", { allocationId: "al-1", invoiceId: "inv-usd", amount: "19480" });

    expect(made.date).toBe("2026-10-01");
    expect(books.fx(FxSide.Receivable)).toEqual({ control: major(29_370n * SCALE), unrealised: major(950n * SCALE), realised: major(-100n * SCALE) });
    expect(major(books.world.balance(FX_CONTROL[FxSide.Receivable], "2026-09-30"))).toBe(major((48_950n - 19_480n) * SCALE));
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("a day asked for by name is held by a standing run even when the allocation itself posts nothing", () => {
  it("voucher and invoice both at 48.00, the August run standing: 10 August is refused in Arabic naming the run, nothing is allocated, and 1 September is taken", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable, "inv-usd", { date: "2026-08-05" });
    await books.voucher(FxSide.Receivable, "m-1", "400", { date: "2026-08-05", currency: "USD" });
    await books.rate("fx-sep-1", "48.50", "2026-09-01");
    const runId = await books.revalue("48.45");
    const runNo = String(((await books.world.request("GET", "/revaluation/runs")).body.runs as { entryId: string; entryNo: string }[]).find((run) => run.entryId === runId)?.entryNo);
    const entries = books.world.count("journal_entry");

    const early = await books.world.request("POST", "/vouchers/m-1/allocations", { allocationId: "al-early", invoiceId: "inv-usd", amount: "19200", date: "2026-08-10" });

    expect(`${early.status} ${String(early.body.error)}`).toBe("422 FX_POSTING_BEFORE_REVALUATION");
    expect(String(early.body.message)).toMatch(ARABIC);
    expect(String(early.body.message)).toContain(runNo);
    expect(early.body.earliestAllowedDate).toBe("2026-09-01");
    expect(allocationDay("al-early")).toBeNull();
    expect(books.world.count("journal_entry")).toBe(entries);

    const onRunDay = await books.world.request("POST", "/vouchers/m-1/allocations", { allocationId: "al-run-day", invoiceId: "inv-usd", amount: "19200", date: "2026-08-31" });
    expect(`${onRunDay.status} ${String(onRunDay.body.error)}`).toBe("422 FX_POSTING_BEFORE_REVALUATION");

    await books.ok("POST", "/vouchers/m-1/allocations", { allocationId: "al-after", invoiceId: "inv-usd", amount: "19200", date: "2026-09-01" });
    expect(allocationDay("al-after")).toBe("2026-09-01");
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("a day nobody chose falls forward out of a month whose VAT return is filed", () => {
  async function julyFiledWithUsdMoney(withCheque = false): Promise<void> {
    books = await openFxBooks();
    await books.rate("fx-jul-1", "47.50", "2026-07-01");
    await books.rate("fx-jul-20", "47.80", "2026-07-20");
    await books.invoice(FxSide.Receivable, "inv-usd", { date: "2026-07-05" });
    await books.voucher(FxSide.Receivable, "m-1", "400", { date: "2026-07-20", currency: "USD" });
    if (withCheque) await books.ok("POST", "/cheques", { id: "chq", chequeNumber: "N-chq", bankName: "بنك مصر", issueDate: "2026-07-20", dueDate: "2026-07-20", branchId: "BR-MAIN", partyId: "cust-usd", counterpartyGlAccountId: "1105", amount: "4780", direction: "incoming", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" } });
    await books.ok("POST", "/gl/vat-filings", { id: "VATR-2026-07", periodFrom: "2026-07-01", periodTo: "2026-07-31", netAmount: "0.00" });
  }

  it("July filed, USD money dated 20 July, no date sent: the allocation takes 1 August and its realised difference lands there, not in the filed month", async () => {
    await julyFiledWithUsdMoney();
    const julyBefore = books.world.balance("4920", "2026-07-31") + books.world.balance("5920", "2026-07-31");

    const made = await books.ok("POST", "/vouchers/m-1/allocations", { allocationId: "al-1", invoiceId: "inv-usd", amount: "19120" });

    expect(made.date).toBe("2026-08-01");
    expect(allocationDay("al-1")).toBe("2026-08-01");
    expect(books.world.balance("4920", "2026-07-31") + books.world.balance("5920", "2026-07-31")).toBe(julyBefore);
    expect(-(books.world.balance("4920") + books.world.balance("5920"))).toBe(120n * SCALE);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a day in the filed month asked for by name is still refused, naming the filing", async () => {
    await julyFiledWithUsdMoney();

    const asked = await books.world.request("POST", "/vouchers/m-1/allocations", { allocationId: "al-named", invoiceId: "inv-usd", amount: "19120", date: "2026-07-25" });

    expect(`${asked.status} ${String(asked.body.error)}`).toBe("422 VAT_PERIOD_ALREADY_FILED");
    expect(String(asked.body.message)).toMatch(ARABIC);
    expect(allocationDay("al-named")).toBeNull();
  });

  it("a cheque issued in the filed month, allocated with no date, takes 1 August too", async () => {
    await julyFiledWithUsdMoney(true);

    await books.ok("POST", "/cheques/chq/allocations", { allocationId: "al-chq", invoiceId: "inv-usd", amount: "4780" });

    expect(allocationDay("al-chq")).toBe("2026-08-01");
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
