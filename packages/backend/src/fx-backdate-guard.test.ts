import { afterEach, describe, expect, it } from "vitest";
import { FX_REVALUATION_LINE_MEMO } from "@mezan/domain";
import { FxSide, openFxBooks, type FxBooks } from "./test-helpers/fx-books.js";

const ARABIC = /[؀-ۿ]/;

let books: FxBooks;

afterEach(() => books?.world.close());

const manual = (id: string, date: string, accountId: string, currency: string | null = "USD") => ({
  id,
  date,
  memo: "قيد يدوي",
  lines: [
    { accountId, debit: "480", credit: "0", ...(currency ? { currency, fxRate: "48" } : {}), ...(accountId === "1105" ? { partyId: "cust-usd" } : {}) },
    { accountId: "1300-1", debit: "0", credit: "480" },
  ],
});

async function augustRun(): Promise<string> {
  books = await openFxBooks();
  await books.invoice(FxSide.Receivable);
  const entryId = await books.revalue("48.45");
  const runs = (await books.world.request("GET", "/revaluation/runs")).body.runs as { entryId: string; entryNo: string }[];
  return String(runs.find((run) => run.entryId === entryId)?.entryNo);
}

const entries = () => books.world.count("journal_entry");

describe("the id a caller gives a journal entry opens no door", () => {
  it("a USD receivable line dated before a standing run is refused under any id, and an id in the system's namespace is refused for what it is", async () => {
    const runNo = await augustRun();
    const before = entries();

    const plain = await books.world.request("POST", "/gl/journal-entries", manual("mj-ctl", "2026-08-20", "1105"));
    expect(`${plain.status} ${String(plain.body.error)}`).toBe("422 FX_POSTING_BEFORE_REVALUATION");
    expect(String(plain.body.message)).toContain(runNo);

    for (const url of ["/gl/journal-entries", "/gl/journal-entries/draft"]) {
      const res = await books.world.request("POST", url, manual("FXR:release:x", "2026-08-20", "1105"));
      expect(`${res.status} ${String(res.body.error)}`, url).toBe("422 JOURNAL_ENTRY_ID_RESERVED");
      expect(String(res.body.message)).toMatch(ARABIC);
      expect(String(res.body.messageEn)).toMatch(/reserved/i);
    }
    expect(entries()).toBe(before);
  });

  it.each(["FXR:al-1", "FXR:release:inv:late:al-1:0", "inv-usd:void", "pi-usd:cancel", "v-1:REV", "PI-JE:pi-usd", "CHQ-JE:c1", "OB-CUST-JE:cust-usd", "DEP-JE:run-1", "cert-1-DED", "cert-1-DED-VOID"])("%s is refused as a journal entry id on create, on draft and as a reversal id — dated where nothing else would refuse it", async (id) => {
    books = await openFxBooks();
    await books.ok("POST", "/gl/journal-entries", manual("mj-plain", "2026-09-05", "2190", null));
    const before = entries();

    for (const url of ["/gl/journal-entries", "/gl/journal-entries/draft"]) {
      const res = await books.world.request("POST", url, manual(id, "2026-09-05", "2190", null));
      expect(`${res.status} ${String(res.body.error)}`, url).toBe("422 JOURNAL_ENTRY_ID_RESERVED");
    }
    const reversed = await books.world.request("POST", "/gl/journal-entries/mj-plain/reverse", { reversalId: id, date: "2026-09-06", memo: "خطأ" });
    expect(`${reversed.status} ${String(reversed.body.error)}`).toBe("422 JOURNAL_ENTRY_ID_RESERVED");
    expect(String(reversed.body.message)).toMatch(ARABIC);
    expect(entries()).toBe(before);
  });

  it("a voucher cannot be created under, or reversed into, an id in the system's namespace", async () => {
    books = await openFxBooks();
    const body = { date: "2026-09-10", amount: "100", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "1105", voucherType: "customer_collection", customerId: "cust-usd" };
    const created = await books.world.request("POST", "/vouchers", { id: "FXR:release:v", ...body });
    expect(`${created.status} ${String(created.body.error)}`).toBe("422 JOURNAL_ENTRY_ID_RESERVED");
    const collected = await books.world.request("POST", "/vouchers/collections", { id: "v-1:REV", date: "2026-09-10", customerId: "cust-usd", branchId: "BR-MAIN", treasuryAccountId: "ta-cash", amount: "100", paymentMethod: "cash", allocations: [] });
    expect(`${collected.status} ${String(collected.body.error)}`).toBe("422 JOURNAL_ENTRY_ID_RESERVED");

    await books.voucher(FxSide.Receivable, "v-ok", "100");
    const reversed = await books.world.request("POST", "/vouchers/v-ok/reverse", { reversalId: "FXR:release:m", memo: "خطأ", date: "2026-09-12" });
    expect(`${reversed.status} ${String(reversed.body.error)}`).toBe("422 JOURNAL_ENTRY_ID_RESERVED");
    expect((await books.world.request("GET", "/vouchers/v-ok")).body.status).toBe("confirmed");
  });
});

describe("the lock is checked wherever an entry becomes posted", () => {
  it("a draft saved before the run is refused when it is posted after it", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    await books.ok("POST", "/gl/journal-entries/draft", manual("mj-draft", "2026-08-20", "1105"));
    await books.revalue("48.45");

    const posted = await books.world.request("POST", "/gl/journal-entries/mj-draft/post", {});

    expect(`${posted.status} ${String(posted.body.error)}`).toBe("422 FX_POSTING_BEFORE_REVALUATION");
    expect((await books.world.request("GET", "/gl/journal-entries/mj-draft")).body.status).toBe("draft");
  });

  it("an entry posted before the run cannot be reversed on or before the run's day; the day after it can", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    await books.ok("POST", "/gl/journal-entries", manual("mj-early", "2026-08-20", "1105"));
    await books.rate("fx-sep-1", "48.50", "2026-09-01");
    await books.revalue("48.45");

    for (const date of ["2026-08-25", "2026-08-31"]) {
      const refused = await books.world.request("POST", "/gl/journal-entries/mj-early/reverse", { date, memo: "خطأ" });
      expect(`${refused.status} ${String(refused.body.error)}`, date).toBe("422 FX_POSTING_BEFORE_REVALUATION");
    }
    expect((await books.world.request("POST", "/gl/journal-entries/mj-early/reverse", { date: "2026-09-01", memo: "خطأ" })).status).toBe(201);
  });

  it("a residue sweep dated on the run's own day is held like any other posting — nothing the system posts after a run lands on or before it", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    await books.invoice(FxSide.Receivable, "inv-b");
    await books.voucher(FxSide.Receivable, "v-all", "48000", { date: "2026-08-25" });
    await books.ok("POST", "/vouchers/v-all/allocations", { allocationId: "al-all", invoiceId: "inv-b", amount: "48000" });
    await books.ok("POST", "/gl/journal-entries", {
      id: "Z-RES", date: "2026-08-25", memo: "أثر إعادة تقييم قديمة",
      lines: [{ accountId: "1105", debit: "0.000003", credit: "0", currency: "USD", fxRate: "48.00", memo: FX_REVALUATION_LINE_MEMO, partyId: "cust-usd" }, { accountId: "2190", debit: "0", credit: "0.000003" }],
    });
    books.world.sqlite.prepare("INSERT INTO fx_revaluation_share (entry_id, item_id, account_id, kind, party_id, currency, amount, item_type) VALUES ('Z-RES', 'inv-b', '1105', 'sales', 'cust-usd', 'USD', 3, 'invoice')").run();
    await books.rate("fx-sep-1", "48.50", "2026-09-01");
    await books.revalue("48.45");
    const before = entries();

    const held = await books.world.request("POST", "/revaluation/residue/sweep", { date: "2026-08-31" });
    expect(`${held.status} ${String(held.body.error)}`).toBe("422 FX_POSTING_BEFORE_REVALUATION");
    expect(entries()).toBe(before);

    expect((await books.world.request("POST", "/revaluation/residue/sweep", { date: "2026-09-01" })).status).toBe(201);
  });
});

describe("the lock holds only what the run restated", () => {
  it("a USD-flagged line on an expense account dated before the run is taken; the same day on the receivable control is refused, naming the run, the first free day and the way out", async () => {
    const runNo = await augustRun();

    const expense = await books.world.request("POST", "/gl/journal-entries", manual("mj-exp", "2026-08-20", "5110"));
    expect(expense.status, JSON.stringify(expense.body)).toBe(201);

    const control = await books.world.request("POST", "/gl/journal-entries", manual("mj-ctl", "2026-08-20", "1105"));
    expect(`${control.status} ${String(control.body.error)}`).toBe("422 FX_POSTING_BEFORE_REVALUATION");
    const message = String(control.body.message);
    expect(message).toContain(runNo);
    expect(message).toContain("2026-09-01");
    expect(message).toMatch(/أرّخ[^.]*2026-09-01[^.]*أو اعكس التشغيل/);
    expect(String(control.body.messageEn)).toMatch(/2026-09-01 or later, or reverse the run first/);
    expect(control.body.earliestAllowedDate).toBe("2026-09-01");
  });

  it("a line in another currency on the same control account is not held by a USD run, and a base line never is", async () => {
    await augustRun();
    await books.rate("fx-eur", "53.00", "2026-08-01", "EUR");

    expect((await books.world.request("POST", "/gl/journal-entries", manual("mj-eur", "2026-08-20", "1105", "EUR"))).status).toBe(201);
    expect((await books.world.request("POST", "/gl/journal-entries", manual("mj-egp", "2026-08-20", "1105", null))).status).toBe(201);
  });

  it("a USD line on a treasury account — an asset the run restates — is held", async () => {
    await augustRun();

    const res = await books.world.request("POST", "/gl/journal-entries", { id: "mj-bank", date: "2026-08-20", memo: "قيد يدوي", lines: [{ accountId: "1310", debit: "480", credit: "0", currency: "USD", fxRate: "48" }, { accountId: "2190", debit: "0", credit: "480" }] });

    expect(`${res.status} ${String(res.body.error)}`).toBe("422 FX_POSTING_BEFORE_REVALUATION");
  });
});
