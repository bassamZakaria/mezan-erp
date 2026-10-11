import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-support.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const FAMILIES = [
  { name: "sales", url: "/sales/historical-import/commit", table: "historical_sales_archive", docType: "SALES_INVOICE", party: { customerId: "CUST-DEMO-1" }, control: "1105" },
  { name: "purchase", url: "/purchases/historical-import/commit", table: "historical_purchase_archive", docType: "PURCHASE_INVOICE", party: { supplierId: "SUPP-DEMO-1" }, control: "2100" },
] as const;

type Family = (typeof FAMILIES)[number];

function rows(family: Family, tag: string, dates: readonly string[]) {
  return dates.map((date, i) => ({
    rowNumber: i + 1, docType: family.docType, documentNumber: `${tag}-${family.name}-${i + 1}`, ...family.party, date, dueDate: date, itemId: "ITEM-DEMO-1", qty: "5", unitCost: "100", amountPaid: "200",
  }));
}

function written(family: Family) {
  return { archives: world.count(family.table), entries: world.count("journal_entry"), control: world.balance(family.control) };
}

describe.each(FAMILIES)("a $name history batch is written whole or not at all", (family) => {
  it("one document in a closed month: 422 naming the month in both languages, and the earlier open-month document is neither archived nor posted", async () => {
    const before = written(family);

    const refused = await world.request("POST", family.url, { rows: rows(family, "HB-CLOSED", ["2026-08-05", "2026-06-05"]) });

    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      error: "PERIOD_NOT_OPEN_FOR_POSTING",
      message: "الفترة المحاسبية «يونيو 2026» مغلقة ولا تسمح بالترحيل.",
      messageEn: "Fiscal period June 2026 is closed and does not accept postings.",
      periodId: "fp-2026-06",
      status: "closed",
    });
    expect(written(family)).toEqual(before);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("one document in a year no period covers: 422, nothing written", async () => {
    const before = written(family);

    const refused = await world.request("POST", family.url, { rows: rows(family, "HB-NOYEAR", ["2026-08-06", "2019-03-01"]) });

    expect(`${refused.status} ${refused.body.error}`).toBe("422 NO_FISCAL_PERIOD_FOR_DATE");
    expect(refused.body.messageEn).toBe('No fiscal period covers the date "2019-03-01".');
    expect(written(family)).toEqual(before);
  });

  it("a write that fails on the second document leaves the first one unwritten too", async () => {
    const before = written(family);
    world.sqlite.exec(
      `CREATE TRIGGER hb_fail_${family.name} BEFORE INSERT ON ${family.table} WHEN NEW.original_number = 'HB-FAIL-${family.name}-2' BEGIN SELECT RAISE(ABORT, 'disk failure'); END`,
    );
    try {
      const failed = await world.request("POST", family.url, { rows: rows(family, "HB-FAIL", ["2026-08-07", "2026-08-08"]) });
      expect(failed.status).toBe(500);
    } finally {
      world.sqlite.exec(`DROP TRIGGER hb_fail_${family.name}`);
    }
    expect(written(family)).toEqual(before);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("the same batch with every document in an open month is archived and posted once per document", async () => {
    const before = written(family);

    const committed = await world.request("POST", family.url, { rows: rows(family, "HB-OPEN", ["2026-08-05", "2026-09-05"]) });

    expect(committed.status).toBe(201);
    expect((committed.body.archivedIds as string[]).length).toBe(2);
    const after = written(family);
    expect({ archives: after.archives - before.archives, entries: after.entries - before.entries }).toEqual({ archives: 2, entries: 2 });
    expect(after.control - before.control).toBe(family.name === "sales" ? 600_000_000n : -600_000_000n);
  });
});
