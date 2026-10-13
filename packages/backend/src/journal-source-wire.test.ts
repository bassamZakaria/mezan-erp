import { afterEach, describe, expect, it } from "vitest";
import { FX_REVALUATION_LINE_MEMO } from "@mezan/domain";
import { FxSide, openFxBooks, type FxBooks } from "./test-helpers/fx-books.js";

let books: FxBooks;

afterEach(() => books?.world.close());

const forged = (id: string, accountId: string) => ({
  id,
  date: "2026-09-05",
  memo: "قيد يدوي",
  source: "system",
  lines: [
    { accountId, debit: "480", credit: "0", memo: FX_REVALUATION_LINE_MEMO },
    { accountId: "3100", debit: "0", credit: "480", memo: FX_REVALUATION_LINE_MEMO },
  ],
});

describe("a journal entry a person keys is a manual entry whatever the request says", () => {
  it("«source: system» on create, on draft and on a draft's edit is stored as manual and listed with the manual entries", async () => {
    books = await openFxBooks();

    await books.ok("POST", "/gl/journal-entries", forged("mj-posted", "2190"));
    await books.ok("POST", "/gl/journal-entries/draft", forged("mj-draft", "2190"));
    const { id: _id, ...edit } = forged("mj-draft", "2190");
    await books.ok("PUT", "/gl/journal-entries/mj-draft", edit, 200);

    for (const id of ["mj-posted", "mj-draft"]) expect((await books.world.request("GET", `/gl/journal-entries/${id}`)).body.source, id).toBe("manual");
    const manualIds = ((await books.world.request("GET", "/gl/journal-entries?source=manual")).body as unknown as { id: string }[]).map((entry) => entry.id);
    expect(manualIds).toEqual(expect.arrayContaining(["mj-posted", "mj-draft"]));
    expect(books.world.count("journal_entry", "id IN ('mj-posted','mj-draft') AND source = 'system'")).toBe(0);
  });

  it("a keyed line on a control account stays an unlinked line of the reconciliation", async () => {
    books = await openFxBooks();
    await books.invoice(FxSide.Receivable);
    const keyed = forged("mj-ar", "1105");

    await books.ok("POST", "/gl/journal-entries", { ...keyed, lines: keyed.lines.map((line) => (line.accountId === "1105" ? { ...line, partyId: "cust-usd" } : line)) });

    const unlinked = ((await books.world.request("GET", "/reconciliation?asOfDate=2026-09-30")).body.unlinked ?? []) as { entryId: string }[];
    expect(unlinked.map((line) => line.entryId)).toContain("mj-ar");
  });
});
