import { afterEach, describe, expect, it } from "vitest";
import { clientSuppliedId } from "@mezan/contracts";
import { DuplicateRecordIdError, isReservedJournalEntryId } from "@mezan/domain";
import { FxSide, openFxBooks, type FxBooks } from "./test-helpers/fx-books.js";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";

const ARABIC = /[؀-ۿ]/;
const RESERVED = "422 JOURNAL_ENTRY_ID_RESERVED";

let books: FxBooks;

afterEach(() => books?.world.close());

const adjustment = (adjustmentId: string, qty: string) => ({ adjustmentId, warehouseId: "WH-MAIN", reason: "PHYSICAL_COUNT", occurredAt: "2026-09-06", lines: [{ itemId: "STK-1", direction: "IN", qty, unitCost: "100" }] });

describe("an allocation id cannot name the release entry of a later relief", () => {
  it("«release:inv-usd:1» is refused on a voucher allocation, a cheque allocation and a collection, and the return that releases a run's share still confirms", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable, "inv-usd", { date: "2026-08-03" });
    await books.voucher(FxSide.Receivable, "v1", "200");
    await books.cheque(FxSide.Receivable, "ch1", "200");
    const before = books.world.count("journal_entry");

    const onVoucher = await books.world.request("POST", "/vouchers/v1/allocations", { allocationId: "release:inv-usd:1", invoiceId: "inv-usd", amount: "200" });
    const onCheque = await books.world.request("POST", "/cheques/ch1/allocations", { allocationId: "release:inv-usd:1", invoiceId: "inv-usd", amount: "200" });
    const onCollection = await books.world.request("POST", "/vouchers/collections", { id: "col-1", date: "2026-09-10", customerId: "cust-usd", branchId: "BR-MAIN", treasuryAccountId: "ta-cash", amount: "200", paymentMethod: "cash", allocations: [{ allocationId: "release:inv-usd:1", invoiceId: "inv-usd", amount: "200" }] });

    for (const res of [onVoucher, onCheque, onCollection]) {
      expect(`${res.status} ${String(res.body.error)}`).toBe(RESERVED);
      expect(String(res.body.message)).toMatch(ARABIC);
      expect(String(res.body.messageEn)).toMatch(/reserved/i);
    }
    expect(books.world.count("journal_entry")).toBe(before);
    expect(books.world.count("journal_entry", "id LIKE 'FXR:release:%'")).toBe(0);

    await books.ok("POST", "/vouchers/v1/allocations", { allocationId: "al-v1", invoiceId: "inv-usd", amount: "200" });
    await books.revalue("49.00", "2026-09-30");
    await books.ok("POST", "/sales-returns/from-invoice", { id: "ret1", date: "2026-10-02", memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: "inv-usd", reason: "OTHER", requested: [{ itemId: "SVC-1", qty: "1" }] });
    await books.rate("fx-oct", "49.00", "2026-10-02");
    await books.ok("POST", "/sales-returns/ret1/confirm", {}, 200);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("a stock adjustment's id cannot name another document's system entry", () => {
  it("«inv-usd:void» is refused, so the invoice can still be voided", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    const before = books.world.count("journal_entry");

    const res = await books.world.request("POST", "/inventory/adjustments", adjustment("inv-usd:void", "1"));

    expect(`${res.status} ${String(res.body.error)}`).toBe(RESERVED);
    expect(String(res.body.message)).toMatch(ARABIC);
    expect(books.world.count("journal_entry")).toBe(before);
    await books.voidInvoice(FxSide.Receivable);
    expect((await books.world.request("GET", "/sales-invoices/inv-usd")).body.status).toBe("reversed");
  });

  it("a caller-made «ADJ1:REVERSAL» is refused, so ADJ1 can still be reversed", async () => {
    books = await openFxBooks();
    await books.ok("POST", "/inventory/adjustments", adjustment("ADJ1", "2"));

    const forged = await books.world.request("POST", "/inventory/adjustments", adjustment("ADJ1:REVERSAL", "1"));
    expect(`${forged.status} ${String(forged.body.error)}`).toBe(RESERVED);

    const reversed = await books.world.request("POST", "/inventory/adjustments/ADJ1/reverse", { memo: "سبب العكس", date: "2026-09-07" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBeLessThan(300);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each([
    ["/inventory/transfers", { transferId: "TR:1", fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-MAIN", occurredAt: "2026-09-06", lines: [{ itemId: "STK-1", qty: "1" }] }],
  ])("%s refuses an id in the system's namespace", async (url, body) => {
    books = await openFxBooks();
    const res = await books.world.request("POST", url, body);
    expect(`${res.status} ${String(res.body.error)}`).toBe(RESERVED);
  });
});

describe("an entry id that is already taken is an Arabic conflict, never a 500", () => {
  it("a system entry already standing under the id a void would mint answers 409", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    books.world.sqlite.prepare("INSERT INTO journal_entry (id, entry_no, date, memo, status, source, created_at) VALUES ('inv-usd:void', NULL, '2026-09-05', 'قيد قديم', 'draft', 'system', '2026-09-05T00:00:00.000Z')").run();

    const res = await books.world.request("POST", "/sales-invoices/inv-usd/void", { reason: "خطأ في الفاتورة" });

    expect(`${res.status} ${String(res.body.error)}`).toBe(`409 ${new DuplicateRecordIdError("x").code}`);
    expect(String(res.body.message)).toMatch(ARABIC);
    expect(String(res.body.messageEn)).toMatch(/already belongs to an existing record/i);
    expect((await books.world.request("GET", "/sales-invoices/inv-usd")).body.status).toBe("confirmed");
  });
});

describe("the wire's id rule and the journal's reserved namespace agree", () => {
  it.each(["FXR:al-1", "FXR:release:inv:late:al-1:0", "inv-usd:void", "pi-usd:cancel", "ADJ1:REVERSAL", "PI-JE:pi-usd", "CHQ-JE:c1", "OB-CUST-JE:cust-usd:v2", "DEP-JE:run-1", "YEAR-CLOSE:2026", "COLL:inv:1", "cert-1-DED", "cert-1-DED-VOID"])("%s is reserved by the journal and refused by the contract", (id) => {
    expect(isReservedJournalEntryId(id)).toBe(true);
    expect(clientSuppliedId.safeParse(id).success).toBe(false);
  });

  it.each(["4be458e5-2c98-4a2b-9f6e-5d0d3b480cf5", "je-1", "SCN-X-0042", "قيد-1"])("%s is accepted by the contract and not reserved by the journal", (id) => {
    expect(clientSuppliedId.safeParse(id).success).toBe(true);
    expect(isReservedJournalEntryId(id)).toBe(false);
  });
});
