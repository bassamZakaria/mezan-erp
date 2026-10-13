import { afterEach, describe, expect, it } from "vitest";
import { FX_REVALUATION_LINE_MEMO } from "@mezan/domain";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";
import { FxSide, openFxBooks, type FxBooks } from "./test-helpers/fx-books.js";

let books: FxBooks;

afterEach(() => books?.world.close());

async function settledInvoiceWithRestatementLeft(entryId: string, amount: string, item: { id: string; type: string } = { id: "inv-usd", type: "invoice" }): Promise<void> {
  await books.ok("POST", "/gl/journal-entries", {
    id: entryId, date: "2026-09-10", memo: "أثر إعادة تقييم قديمة",
    lines: [
      { accountId: "1105", debit: amount, credit: "0", currency: "USD", fxRate: "48.00", memo: FX_REVALUATION_LINE_MEMO, partyId: "cust-usd" },
      { accountId: "2190", debit: "0", credit: amount },
    ],
  });
  books.world.sqlite
    .prepare("INSERT INTO fx_revaluation_share (entry_id, item_id, account_id, kind, party_id, currency, amount, item_type) VALUES (?, ?, '1105', 'sales', 'cust-usd', 'USD', ?, ?)")
    .run(entryId, item.id, BigInt(amount.replace(".", "")), item.type);
}

const residue = async () => (await books.world.request("GET", "/reconciliation")).body.foreignResidue as { total: string; rows: Record<string, string>[] };

function controlLinesOf(entryLike: string): { account: string; party: string | null; net: bigint }[] {
  const rows = books.world.sqlite
    .prepare("SELECT account_id, party_id, debit - credit AS net FROM journal_line WHERE entry_id LIKE ? ORDER BY line_no")
    .safeIntegers()
    .all(entryLike) as { account_id: string; party_id: string | null; net: bigint }[];
  return rows.map((row) => ({ account: row.account_id, party: row.party_id, net: row.net }));
}

describe("the residue sweep, for a restatement left on a document that has closed", () => {
  it("a sub-piastre one is swept to realised differences under the document's own party, and nothing is left reported", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    await books.settle(FxSide.Receivable, "v-all", "48000");
    await settledInvoiceWithRestatementLeft("Z-RES", "0.000003");
    const row = { kind: "item", ref: "inv-usd", itemType: "invoice", currency: "USD", base: "0.000003" };
    expect(await residue()).toEqual({ total: "0.000003", rows: [row] });
    const lossBefore = books.world.balance("5920");

    const swept = await books.ok("POST", "/revaluation/residue/sweep", { date: "2026-09-30" });

    expect(swept).toMatchObject({ swept: [row], refused: [] });
    expect(controlLinesOf("FXR:release:inv-usd:%")).toEqual([
      { account: "1105", party: "cust-usd", net: -3n },
      { account: "5920", party: null, net: 3n },
    ]);
    expect(books.world.balance("1105")).toBe(0n);
    expect(books.world.balance("5920") - lossBefore).toBe(3n);
    expect(await residue()).toEqual({ total: "0.000000", rows: [] });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a sweep dated before the restatement it clears posts on the restatement's own day, never before it exists", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    await books.settle(FxSide.Receivable, "v-all", "48000");
    await settledInvoiceWithRestatementLeft("Z-RES", "0.000003");

    await books.ok("POST", "/revaluation/residue/sweep", { date: "2026-09-01" });

    const release = books.world.sqlite.prepare("SELECT substr(date, 1, 10) AS day FROM journal_entry WHERE id LIKE 'FXR:release:inv-usd:%'").all() as { day: string }[];
    expect(release).toEqual([{ day: "2026-09-10" }]);
    expect(await residue()).toEqual({ total: "0.000000", rows: [] });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("one left on money that has been applied in full is swept the same way, by the money's own reference", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    await books.voucher(FxSide.Receivable, "v-held", "1000", { date: "2026-08-22", currency: "USD" });
    await books.ok("POST", "/vouchers/v-held/allocations", { allocationId: "al-held", invoiceId: "inv-usd", amount: "48000" });
    await settledInvoiceWithRestatementLeft("Z-MONEY", "0.000002", { id: "v-held", type: "money" });
    const row = { kind: "item", ref: "v-held", itemType: "money", currency: "USD", base: "0.000002" };
    expect(await residue()).toEqual({ total: "0.000002", rows: [row] });

    const swept = await books.ok("POST", "/revaluation/residue/sweep", { date: "2026-09-30" });

    expect(swept).toMatchObject({ swept: [row], refused: [] });
    expect(controlLinesOf("FXR:release:v-held:%")).toEqual([
      { account: "1105", party: "cust-usd", net: -2n },
      { account: "5920", party: null, net: 2n },
    ]);
    expect(await residue()).toEqual({ total: "0.000000", rows: [] });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a larger one is refused in Arabic, posts nothing and stays reported", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    await books.settle(FxSide.Receivable, "v-all", "48000");
    await settledInvoiceWithRestatementLeft("Z-BIG", "0.500000");
    const row = { kind: "item", ref: "inv-usd", itemType: "invoice", currency: "USD", base: "0.500000" };
    const entriesBefore = books.world.count("journal_entry");

    const left = await books.ok("POST", "/revaluation/residue/sweep", { date: "2026-09-30" }, 200);

    expect(left).toMatchObject({ swept: [], sweptCount: 0, entryId: null, refused: [expect.objectContaining(row)] });
    expect(String((left.refused as { message: string }[])[0]?.message)).toMatch(/[؀-ۿ]/);
    expect(books.world.count("journal_entry")).toBe(entriesBefore);
    expect(books.world.balance("1105")).toBe(500_000n);
    expect(await residue()).toEqual({ total: "0.500000", rows: [row] });
  });
});
