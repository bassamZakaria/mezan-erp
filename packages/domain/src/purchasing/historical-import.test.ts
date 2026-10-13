import { insertOnly } from "../records/test-helpers/insert-only.js";
import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  previewHistoricalImport,
  importHistoricalPurchaseDocuments,
  type HistoricalImportRowInput,
  type HistoricalPurchaseArchive,
  type HistoricalPurchaseArchiveRepository,
  type HistoricalPurchaseDocType,
  type HistoricalImportGlPosting,
  type HistoricalImportGlPostingPort,
  type HistoricalImportGlAccounts,
} from "./historical-import.js";

const now = () => "2026-08-21T09:00:00.000Z";
const ACCOUNTS: HistoricalImportGlAccounts = {
  openingBalanceAccountId: "3900-opening-balance",
  payableAccountId: "2100-ap",
};

class InMemoryArchives implements HistoricalPurchaseArchiveRepository {
  readonly rows = new Map<string, HistoricalPurchaseArchive>();
  async create(archive: HistoricalPurchaseArchive): Promise<void> {
    insertOnly(this.rows, archive.id, archive);
  }
  async list(): Promise<HistoricalPurchaseArchive[]> {
    return [...this.rows.values()];
  }
  async findById(id: string): Promise<HistoricalPurchaseArchive | null> {
    return this.rows.get(id) ?? null;
  }
  async findByOriginalNumber(
    docType: HistoricalPurchaseDocType,
    originalNumber: string,
  ): Promise<HistoricalPurchaseArchive | null> {
    for (const a of this.rows.values()) {
      if (a.docType === docType && a.originalNumber === originalNumber) return a;
    }
    return null;
  }
}

/** Records every GL posting the import hands off. */
class RecordingGlPort implements HistoricalImportGlPostingPort {
  readonly postings: HistoricalImportGlPosting[] = [];
  async post(posting: HistoricalImportGlPosting): Promise<void> {
    this.postings.push(posting);
  }
}

function row(overrides: Partial<HistoricalImportRowInput> & { rowNumber: number }): HistoricalImportRowInput {
  return {
    docType: "PURCHASE_INVOICE",
    documentNumber: "INV-1001",
    supplierId: "sup-1",
    date: "2026-01-15",
    dueDate: null,
    itemId: "item-A",
    description: null,
    qty: Qty.fromMajor("1"),
    unitCost: Money.fromMajor("100.00"),
    amountPaid: Money.fromMajor("0.00"),
    ...overrides,
  };
}

describe("previewHistoricalImport", () => {
  it("groups multiple rows by (docType, documentNumber, supplierId) and computes totals", () => {
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, itemId: "item-A", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("50.00"), amountPaid: Money.fromMajor("30.00") }),
      row({ rowNumber: 2, itemId: "item-B", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("20.00"), amountPaid: Money.fromMajor("30.00") }),
    ];
    const preview = previewHistoricalImport(rows);
    expect(preview.errors).toHaveLength(0);
    expect(preview.groups).toHaveLength(1);
    const g = preview.groups[0]!;
    expect(g.lines).toHaveLength(2);
    expect(g.total.toString()).toBe("120.000000"); // 2*50 + 1*20
    expect(g.amountPaid.toString()).toBe("30.000000");
    expect(g.remainingBalance.toString()).toBe("90.000000");
    expect(g.settled).toBe(false);
  });

  it("marks a fully-paid document settled with zero remaining balance", () => {
    const rows: HistoricalImportRowInput[] = [row({ rowNumber: 1, unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("100.00") })];
    const preview = previewHistoricalImport(rows);
    expect(preview.groups[0]?.settled).toBe(true);
    expect(preview.groups[0]?.remainingBalance.toString()).toBe("0.000000");
  });

  it("floors an overpaid document's remaining balance at zero", () => {
    const rows: HistoricalImportRowInput[] = [row({ rowNumber: 1, unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("150.00") })];
    const preview = previewHistoricalImport(rows);
    expect(preview.groups[0]?.remainingBalance.toString()).toBe("0.000000");
    expect(preview.groups[0]?.settled).toBe(true);
  });

  it("excludes an individually-invalid row without aborting the batch", () => {
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, documentNumber: "" }), // missing document number
      row({ rowNumber: 2, supplierId: "" }), // missing supplier
      row({ rowNumber: 3, date: "" }), // missing date
      row({ rowNumber: 4, qty: Qty.zero() }), // non-positive qty
      row({ rowNumber: 5, unitCost: Money.fromMajor("-1.00") }), // negative cost
      row({ rowNumber: 6, amountPaid: Money.fromMajor("-1.00") }), // negative amount paid
      row({ rowNumber: 7, documentNumber: "INV-OK" }), // the only valid row
    ];
    const preview = previewHistoricalImport(rows);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]?.documentNumber).toBe("INV-OK");
  });

  it("one document number under two parties in a batch is reported on each and neither is taken", () => {
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, documentNumber: "DUP-1", supplierId: "party-1" }),
      row({ rowNumber: 2, documentNumber: "DUP-1", supplierId: "party-2" }),
      row({ rowNumber: 3, documentNumber: "OK-1", supplierId: "party-2" }),
    ];
    const preview = previewHistoricalImport(rows);
    expect(preview.groups.map((g) => g.documentNumber)).toEqual(["OK-1"]);
    expect(preview.errors).toEqual([
      { rowNumber: 1, reasons: ['رقم المستند "DUP-1" مكرر في الملف لأكثر من مورد (الصفوف 1، 2). رقم المستند لا يتكرر داخل النوع الواحد.'] },
      { rowNumber: 2, reasons: ['رقم المستند "DUP-1" مكرر في الملف لأكثر من مورد (الصفوف 1، 2). رقم المستند لا يتكرر داخل النوع الواحد.'] },
    ]);
  });

  it("drops a whole group when its rows disagree on date/due date", () => {
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, date: "2026-01-15" }),
      row({ rowNumber: 2, date: "2026-01-16" }), // inconsistent date, same doc
    ];
    const preview = previewHistoricalImport(rows);
    expect(preview.groups).toHaveLength(0);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0]?.reasons[0]).toMatch(/disagree on date/);
  });

  it("groups PURCHASE_INVOICE and PURCHASE_RETURN rows with the same document number separately", () => {
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, docType: "PURCHASE_INVOICE", documentNumber: "DOC-1" }),
      row({ rowNumber: 2, docType: "PURCHASE_RETURN", documentNumber: "DOC-1" }),
    ];
    const preview = previewHistoricalImport(rows);
    expect(preview.groups).toHaveLength(2);
    expect(preview.groups.map((g) => g.docType).sort()).toEqual(["PURCHASE_INVOICE", "PURCHASE_RETURN"]);
  });
});

describe("importHistoricalPurchaseDocuments", () => {
  it("archives a settled document with NO GL posting", async () => {
    const archives = new InMemoryArchives();
    const gl = new RecordingGlPort();
    const rows: HistoricalImportRowInput[] = [row({ rowNumber: 1, unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("100.00") })];
    const result = await importHistoricalPurchaseDocuments(
      { importBatchId: "batch-1", rows },
      { archives, gl, accounts: ACCOUNTS, now },
    );
    expect(result.archived).toHaveLength(1);
    expect(result.archived[0]?.settled).toBe(true);
    expect(gl.postings).toHaveLength(0);
  });

  it("posts Dr opening-balance / Cr payable for an unsettled PURCHASE_INVOICE", async () => {
    const archives = new InMemoryArchives();
    const gl = new RecordingGlPort();
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, docType: "PURCHASE_INVOICE", unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    await importHistoricalPurchaseDocuments({ importBatchId: "batch-1", rows }, { archives, gl, accounts: ACCOUNTS, now });
    expect(gl.postings).toHaveLength(1);
    const posting = gl.postings[0]!;
    expect(posting.sourceDocType).toBe("HISTORICAL_PURCHASE_IMPORT");
    expect(posting.lines).toEqual([
      { accountId: ACCOUNTS.openingBalanceAccountId, debit: expect.objectContaining({}), credit: expect.objectContaining({}) },
      { accountId: ACCOUNTS.payableAccountId, debit: expect.objectContaining({}), credit: expect.objectContaining({}) },
    ]);
    expect(posting.lines[0]?.debit.toString()).toBe("60.000000");
    expect(posting.lines[0]?.credit.toString()).toBe("0.000000");
    expect(posting.lines[1]?.debit.toString()).toBe("0.000000");
    expect(posting.lines[1]?.credit.toString()).toBe("60.000000");
  });

  it("archives nothing when the opening entry is refused — a document dated into a closed month is not left owed with no entry behind it", async () => {
    const archives = new InMemoryArchives();
    const gl = {
      async post(): Promise<never> {
        throw new Error("PERIOD_NOT_OPEN_FOR_POSTING");
      },
    };
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, docType: "PURCHASE_INVOICE", unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    await expect(importHistoricalPurchaseDocuments({ importBatchId: "batch-1", rows }, { archives, gl, accounts: ACCOUNTS, now })).rejects.toThrow("PERIOD_NOT_OPEN_FOR_POSTING");
    expect(await archives.list()).toEqual([]);
  });

  it("posts the mirrored direction for an unsettled PURCHASE_RETURN", async () => {
    const archives = new InMemoryArchives();
    const gl = new RecordingGlPort();
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, docType: "PURCHASE_RETURN", documentNumber: "RET-1", unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    await importHistoricalPurchaseDocuments({ importBatchId: "batch-1", rows }, { archives, gl, accounts: ACCOUNTS, now });
    const posting = gl.postings[0]!;
    // mirrored vs. the invoice case: Dr payable / Cr opening-balance.
    expect(posting.lines[0]?.accountId).toBe(ACCOUNTS.payableAccountId);
    expect(posting.lines[0]?.debit.toString()).toBe("60.000000");
    expect(posting.lines[1]?.accountId).toBe(ACCOUNTS.openingBalanceAccountId);
    expect(posting.lines[1]?.credit.toString()).toBe("60.000000");
  });

  it("is idempotent: re-importing the same document number reports an error and does not duplicate the archive", async () => {
    const archives = new InMemoryArchives();
    const gl = new RecordingGlPort();
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, documentNumber: "DUP-1", unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    const first = await importHistoricalPurchaseDocuments({ importBatchId: "batch-1", rows }, { archives, gl, accounts: ACCOUNTS, now });
    expect(first.archived).toHaveLength(1);

    const second = await importHistoricalPurchaseDocuments(
      { importBatchId: "batch-2", rows: [row({ rowNumber: 1, documentNumber: "DUP-1" })] },
      { archives, gl, accounts: ACCOUNTS, now },
    );
    expect(second.archived).toHaveLength(0);
    expect(second.errors.some((e) => e.reasons.some((r) => r.includes("already imported")))).toBe(true);
    expect((await archives.list()).length).toBe(1);
  });

  it("archives an unsettled document successfully with no GL call when gl/accounts are omitted", async () => {
    const archives = new InMemoryArchives();
    const rows: HistoricalImportRowInput[] = [
      row({ rowNumber: 1, unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    const result = await importHistoricalPurchaseDocuments({ importBatchId: "batch-1", rows }, { archives, now });
    expect(result.archived).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  // Stock is never touched by this path: ImportHistoricalPurchaseDocumentsDeps
  // (see historical-import.ts) has no stock-posting port at all — there is
  // nothing to wire even accidentally. This is enforced structurally by the
  // type signature, not by a runtime assertion.
});
