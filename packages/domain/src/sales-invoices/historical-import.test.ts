import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  previewHistoricalSalesImport,
  importHistoricalSalesDocuments,
  type HistoricalSalesImportRowInput,
  type HistoricalSalesArchive,
  type HistoricalSalesArchiveRepository,
  type HistoricalSalesDocType,
  type HistoricalSalesImportGlPosting,
  type HistoricalSalesImportGlPostingPort,
  type HistoricalSalesImportGlAccounts,
} from "./historical-import.js";

const now = () => "2026-08-21T09:00:00.000Z";
const ACCOUNTS: HistoricalSalesImportGlAccounts = {
  openingBalanceAccountId: "3900-opening-balance",
  receivableAccountId: "1200-ar",
};

class InMemoryArchives implements HistoricalSalesArchiveRepository {
  readonly rows = new Map<string, HistoricalSalesArchive>();
  async create(archive: HistoricalSalesArchive): Promise<void> {
    this.rows.set(archive.id, archive);
  }
  async list(): Promise<HistoricalSalesArchive[]> {
    return [...this.rows.values()];
  }
  async findById(id: string): Promise<HistoricalSalesArchive | null> {
    return this.rows.get(id) ?? null;
  }
  async findByOriginalNumber(
    docType: HistoricalSalesDocType,
    originalNumber: string,
  ): Promise<HistoricalSalesArchive | null> {
    for (const a of this.rows.values()) {
      if (a.docType === docType && a.originalNumber === originalNumber) return a;
    }
    return null;
  }
}

/** Records every GL posting the import hands off. */
class RecordingGlPort implements HistoricalSalesImportGlPostingPort {
  readonly postings: HistoricalSalesImportGlPosting[] = [];
  async post(posting: HistoricalSalesImportGlPosting): Promise<void> {
    this.postings.push(posting);
  }
}

function row(overrides: Partial<HistoricalSalesImportRowInput> & { rowNumber: number }): HistoricalSalesImportRowInput {
  return {
    docType: "SALES_INVOICE",
    documentNumber: "INV-1001",
    customerId: "cust-1",
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

describe("previewHistoricalSalesImport", () => {
  it("groups multiple rows by (docType, documentNumber, customerId) and computes totals", () => {
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, itemId: "item-A", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("50.00"), amountPaid: Money.fromMajor("30.00") }),
      row({ rowNumber: 2, itemId: "item-B", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("20.00"), amountPaid: Money.fromMajor("30.00") }),
    ];
    const preview = previewHistoricalSalesImport(rows);
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
    const rows: HistoricalSalesImportRowInput[] = [row({ rowNumber: 1, unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("100.00") })];
    const preview = previewHistoricalSalesImport(rows);
    expect(preview.groups[0]?.settled).toBe(true);
    expect(preview.groups[0]?.remainingBalance.toString()).toBe("0.000000");
  });

  it("floors an overpaid document's remaining balance at zero", () => {
    const rows: HistoricalSalesImportRowInput[] = [row({ rowNumber: 1, unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("150.00") })];
    const preview = previewHistoricalSalesImport(rows);
    expect(preview.groups[0]?.remainingBalance.toString()).toBe("0.000000");
    expect(preview.groups[0]?.settled).toBe(true);
  });

  it("excludes an individually-invalid row without aborting the batch", () => {
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, documentNumber: "" }), // missing document number
      row({ rowNumber: 2, customerId: "" }), // missing customer
      row({ rowNumber: 3, date: "" }), // missing date
      row({ rowNumber: 4, qty: Qty.zero() }), // non-positive qty
      row({ rowNumber: 5, unitCost: Money.fromMajor("-1.00") }), // negative cost
      row({ rowNumber: 6, amountPaid: Money.fromMajor("-1.00") }), // negative amount paid
      row({ rowNumber: 7, documentNumber: "INV-OK" }), // the only valid row
    ];
    const preview = previewHistoricalSalesImport(rows);
    expect(preview.errors.map((e) => e.rowNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]?.documentNumber).toBe("INV-OK");
  });

  it("one document number under two parties in a batch is reported on each and neither is taken", () => {
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, documentNumber: "DUP-1", customerId: "party-1" }),
      row({ rowNumber: 2, documentNumber: "DUP-1", customerId: "party-2" }),
      row({ rowNumber: 3, documentNumber: "OK-1", customerId: "party-2" }),
    ];
    const preview = previewHistoricalSalesImport(rows);
    expect(preview.groups.map((g) => g.documentNumber)).toEqual(["OK-1"]);
    expect(preview.errors).toEqual([
      { rowNumber: 1, reasons: ['رقم المستند "DUP-1" مكرر في الملف لأكثر من عميل (الصفوف 1، 2). رقم المستند لا يتكرر داخل النوع الواحد.'] },
      { rowNumber: 2, reasons: ['رقم المستند "DUP-1" مكرر في الملف لأكثر من عميل (الصفوف 1، 2). رقم المستند لا يتكرر داخل النوع الواحد.'] },
    ]);
  });

  it("drops a whole group when its rows disagree on date/due date", () => {
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, date: "2026-01-15" }),
      row({ rowNumber: 2, date: "2026-01-16" }), // inconsistent date, same doc
    ];
    const preview = previewHistoricalSalesImport(rows);
    expect(preview.groups).toHaveLength(0);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0]?.reasons[0]).toMatch(/disagree on date/);
  });

  it("groups SALES_INVOICE and SALES_RETURN rows with the same document number separately", () => {
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, docType: "SALES_INVOICE", documentNumber: "DOC-1" }),
      row({ rowNumber: 2, docType: "SALES_RETURN", documentNumber: "DOC-1" }),
    ];
    const preview = previewHistoricalSalesImport(rows);
    expect(preview.groups).toHaveLength(2);
    expect(preview.groups.map((g) => g.docType).sort()).toEqual(["SALES_INVOICE", "SALES_RETURN"]);
  });
});

describe("importHistoricalSalesDocuments", () => {
  it("archives a settled document with NO GL posting", async () => {
    const archives = new InMemoryArchives();
    const gl = new RecordingGlPort();
    const rows: HistoricalSalesImportRowInput[] = [row({ rowNumber: 1, unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("100.00") })];
    const result = await importHistoricalSalesDocuments(
      { importBatchId: "batch-1", rows },
      { archives, gl, accounts: ACCOUNTS, now },
    );
    expect(result.archived).toHaveLength(1);
    expect(result.archived[0]?.settled).toBe(true);
    expect(gl.postings).toHaveLength(0);
  });

  it("posts Dr receivable / Cr opening-balance for an unsettled SALES_INVOICE", async () => {
    const archives = new InMemoryArchives();
    const gl = new RecordingGlPort();
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, docType: "SALES_INVOICE", unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    await importHistoricalSalesDocuments({ importBatchId: "batch-1", rows }, { archives, gl, accounts: ACCOUNTS, now });
    expect(gl.postings).toHaveLength(1);
    const posting = gl.postings[0]!;
    expect(posting.sourceDocType).toBe("HISTORICAL_SALES_IMPORT");
    expect(posting.lines).toEqual([
      { accountId: ACCOUNTS.receivableAccountId, debit: expect.objectContaining({}), credit: expect.objectContaining({}) },
      { accountId: ACCOUNTS.openingBalanceAccountId, debit: expect.objectContaining({}), credit: expect.objectContaining({}) },
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
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, docType: "SALES_INVOICE", unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    await expect(importHistoricalSalesDocuments({ importBatchId: "batch-1", rows }, { archives, gl, accounts: ACCOUNTS, now })).rejects.toThrow("PERIOD_NOT_OPEN_FOR_POSTING");
    expect(await archives.list()).toEqual([]);
  });

  it("posts the mirrored direction for an unsettled SALES_RETURN", async () => {
    const archives = new InMemoryArchives();
    const gl = new RecordingGlPort();
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, docType: "SALES_RETURN", documentNumber: "RET-1", unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    await importHistoricalSalesDocuments({ importBatchId: "batch-1", rows }, { archives, gl, accounts: ACCOUNTS, now });
    const posting = gl.postings[0]!;
    // mirrored vs. the invoice case: Dr opening-balance / Cr receivable.
    expect(posting.lines[0]?.accountId).toBe(ACCOUNTS.openingBalanceAccountId);
    expect(posting.lines[0]?.debit.toString()).toBe("60.000000");
    expect(posting.lines[1]?.accountId).toBe(ACCOUNTS.receivableAccountId);
    expect(posting.lines[1]?.credit.toString()).toBe("60.000000");
  });

  it("is idempotent: re-importing the same document number reports an error and does not duplicate the archive", async () => {
    const archives = new InMemoryArchives();
    const gl = new RecordingGlPort();
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, documentNumber: "DUP-1", unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    const first = await importHistoricalSalesDocuments({ importBatchId: "batch-1", rows }, { archives, gl, accounts: ACCOUNTS, now });
    expect(first.archived).toHaveLength(1);

    const second = await importHistoricalSalesDocuments(
      { importBatchId: "batch-2", rows: [row({ rowNumber: 1, documentNumber: "DUP-1" })] },
      { archives, gl, accounts: ACCOUNTS, now },
    );
    expect(second.archived).toHaveLength(0);
    expect(second.errors.some((e) => e.reasons.some((r) => r.includes("already imported")))).toBe(true);
    expect((await archives.list()).length).toBe(1);
  });

  it("archives an unsettled document successfully with no GL call when gl/accounts are omitted", async () => {
    const archives = new InMemoryArchives();
    const rows: HistoricalSalesImportRowInput[] = [
      row({ rowNumber: 1, unitCost: Money.fromMajor("100.00"), amountPaid: Money.fromMajor("40.00") }),
    ];
    const result = await importHistoricalSalesDocuments({ importBatchId: "batch-1", rows }, { archives, now });
    expect(result.archived).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  // Stock is never touched by this path: ImportHistoricalSalesDocumentsDeps
  // (see historical-import.ts) has no stock-posting port at all — there is
  // nothing to wire even accidentally. This is enforced structurally by the
  // type signature, not by a runtime assertion.
});
